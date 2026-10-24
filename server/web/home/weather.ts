// Current weather, shared by the header and the screensaver overlay.
import { api, type Weather } from '../lib/api.js';

const REFRESH_MS = 15 * 60_000;

/** WMO weather codes (Open-Meteo `weather_code`) in plain words. */
const WMO: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog',
  51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 61: 'Rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};
export const describe = (code: number) => WMO[code] ?? '';

let current: Weather | null = null;
export const weather = () => current;

/** Load now and every 15 minutes; `onChange` runs after each successful load. */
export function startWeather(onChange: () => void) {
  const load = async () => {
    try {
      current = await api.weather();
      onChange();
    } catch {
      /* keep the last reading */
    }
  };
  void load();
  setInterval(() => void load(), REFRESH_MS);
  return load;
}
