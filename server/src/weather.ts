/**
 * WeatherBot's brain. It looks a place up on Open-Meteo (free, no key, weather data from national weather
 * services, shown under the CC BY 4.0 licence) and says what it found. Only the name of the place is sent,
 * never anything about the member who asked.
 */

export const WEATHER_CREDIT = 'Weather data by Open-Meteo.com';

/** Open-Meteo "WMO" weather codes, in words. */
const CODES: Record<number, string> = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'foggy', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'heavy freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'severe thunderstorms with hail',
};
const sky = (code: number): string => CODES[code] ?? 'unsettled';

interface Place {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
}

interface Forecast {
  place: Place;
  current: { temp: number; feels: number; code: number; wind: number };
  days: { date: string; max: number; min: number; rain: number; code: number }[];
}

const cache = new Map<string, { at: number; value: Forecast }>();
const TTL = 10 * 60 * 1000;

/** What counts as a place name: letters, spaces and the usual punctuation, not too long. */
export function cleanPlace(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{M}][\p{L}\p{M} .,'-]{0,59}$/u.test(s) ? s : null;
}

const WEATHER_OFF = () => process.env.QCHAT_WEATHER === 'off';
const WEATHER_FAKE = () => process.env.QCHAT_WEATHER === 'fake';

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json', 'user-agent': 'QChat/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse((await res.text()).slice(0, 300_000));
}

async function load(placeName: string): Promise<Forecast | null> {
  const key = placeName.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  if (WEATHER_FAKE()) {
    const value: Forecast = {
      place: { name: placeName, region: 'Testshire', country: 'United Kingdom', lat: 0, lon: 0 },
      current: { temp: 14, feels: 12, code: 2, wind: 11 },
      days: [
        { date: '2026-01-01', max: 16, min: 9, rain: 40, code: 61 },
        { date: '2026-01-02', max: 15, min: 8, rain: 10, code: 3 },
        { date: '2026-01-03', max: 13, min: 7, rain: 70, code: 63 },
      ],
    };
    return placeName.toLowerCase() === 'nowhereville' ? null : value;
  }

  const geo = (await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(placeName)}`,
  )) as { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] };
  const g = geo.results?.[0];
  if (!g) return null;

  const w = (await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}` +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=auto&wind_speed_unit=mph&forecast_days=3',
  )) as {
    current?: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
    daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] };
  };
  if (!w.current || !w.daily) return null;
  const value: Forecast = {
    place: { name: g.name, region: g.admin1 ?? '', country: g.country ?? '', lat: g.latitude, lon: g.longitude },
    current: { temp: w.current.temperature_2m, feels: w.current.apparent_temperature, code: w.current.weather_code, wind: w.current.wind_speed_10m },
    days: w.daily.time.map((date, i) => ({
      date,
      max: w.daily!.temperature_2m_max[i],
      min: w.daily!.temperature_2m_min[i],
      rain: w.daily!.precipitation_probability_max[i] ?? 0,
      code: w.daily!.weather_code[i],
    })),
  };
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const deg = (n: number) => `${Math.round(n)}°C`;
const where = (p: Place) => [p.name, p.region, p.country].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
const weekday = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });

export type WeatherKind = 'now' | 'forecast';

/** The words WeatherBot says for !weather (now) or !forecast (three days). Never throws. */
export async function weatherReply(kind: WeatherKind, rawPlace: string): Promise<string> {
  const place = cleanPlace(rawPlace);
  if (!place) return 'Tell me a place, like !weather London. (Letters only, please.)';
  if (WEATHER_OFF()) return 'Weather lookups are switched off on this server.';
  try {
    const f = await load(place);
    if (!f) return `I could not find a place called "${place}". Try a nearby town, or add the country.`;
    const today = f.days[0];
    if (kind === 'now') {
      return (
        `${where(f.place)}: ${deg(f.current.temp)} (feels like ${deg(f.current.feels)}), ${sky(f.current.code)}, wind ${Math.round(f.current.wind)} mph. ` +
        `Today: high ${deg(today.max)}, low ${deg(today.min)}, ${today.rain}% chance of rain. (${WEATHER_CREDIT})`
      );
    }
    const lines = f.days.map((d, i) => `${i === 0 ? 'Today' : weekday(d.date)}: ${sky(d.code)}, ${deg(d.min)} to ${deg(d.max)}, ${d.rain}% rain`);
    return `${where(f.place)}: ${lines.join('. ')}. (${WEATHER_CREDIT})`;
  } catch {
    return 'I could not reach the weather service just now. Please try again in a minute.';
  }
}

export const WEATHER_HELP =
  `WeatherBot: !weather London tells you the weather now, !forecast London gives three days. Just !weather uses the location on your profile. ${WEATHER_CREDIT}.`;
