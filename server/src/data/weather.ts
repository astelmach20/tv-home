// Weather from Open-Meteo (no key). Only used when config.json sets `home`.
import { z } from 'zod';
import type { TtlCache } from '../lib/cache.js';
import type { Config } from '../config.js';

const OpenMeteo = z.object({
  current: z.object({
    temperature_2m: z.number(),
    apparent_temperature: z.number(),
    weather_code: z.number(),
    wind_speed_10m: z.number(),
  }),
  // One forecast day: each daily series has exactly today's value first.
  daily: z.object({
    temperature_2m_max: z.tuple([z.number()]).rest(z.number()),
    temperature_2m_min: z.tuple([z.number()]).rest(z.number()),
    precipitation_probability_max: z.tuple([z.number().nullable()]).rest(z.number().nullable()),
    sunset: z.tuple([z.string()]).rest(z.string()),
  }),
});

export const WeatherSchema = z.object({
  temp: z.number().describe('Temperature now, °F'),
  feels: z.number().describe('Feels-like temperature, °F'),
  code: z.number().describe('WMO weather code'),
  wind: z.number().describe('Wind speed, mph'),
  high: z.number().describe("Today's high, °F"),
  low: z.number().describe("Today's low, °F"),
  rain: z.number().describe('Chance of precipitation today, %'),
  sunset: z.string().describe('Sunset, local ISO time'),
});
export type Weather = z.infer<typeof WeatherSchema>;

/** One decimal place: about 10 km, enough for a forecast and no closer to the house than that. */
export const coarse = (deg: number) => (Math.round(deg * 10) / 10).toFixed(1);

export function weatherUrl({ lat, lon, timezone }: NonNullable<Config['home']>): string {
  const q = new URLSearchParams({
    latitude: coarse(lat),
    longitude: coarse(lon),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunset',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone,
    forecast_days: '1',
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

export function weather(cache: TtlCache, home: NonNullable<Config['home']>): Promise<Weather> {
  const url = weatherUrl(home);
  return cache.get(`weather:${url}`, 15 * 60_000, async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`weather: HTTP ${res.status}`);
    const { current: c, daily: d } = OpenMeteo.parse(await res.json());
    return {
      temp: Math.round(c.temperature_2m),
      feels: Math.round(c.apparent_temperature),
      code: c.weather_code,
      wind: Math.round(c.wind_speed_10m),
      high: Math.round(d.temperature_2m_max[0]),
      low: Math.round(d.temperature_2m_min[0]),
      rain: d.precipitation_probability_max[0] ?? 0,
      sunset: d.sunset[0],
    };
  });
}
