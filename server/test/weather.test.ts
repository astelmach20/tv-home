import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/config.js';
import { weatherUrl } from '../src/data/weather.js';

describe('weather', () => {
  it('is off unless config sets a home location', () => {
    expect(ConfigSchema.parse({}).home).toBeUndefined();
    expect(ConfigSchema.parse({ home: { lat: 51.5, lon: -0.12 } }).home).toEqual({
      lat: 51.5,
      lon: -0.12,
      timezone: 'auto',
    });
  });

  it('sends coordinates rounded to one decimal', () => {
    const q = new URL(weatherUrl({ lat: 51.50735, lon: -0.12776, timezone: 'Europe/London' })).searchParams;
    expect(q.get('latitude')).toBe('51.5');
    expect(q.get('longitude')).toBe('-0.1');
    expect(q.get('timezone')).toBe('Europe/London');
  });
});
