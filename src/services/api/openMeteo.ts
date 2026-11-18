/**
 * Open-Meteo: geocoding, current conditions, short-range forecast, historical
 * reanalysis archive, and GloFAS river-discharge forecasts.
 *
 * Keyless and CORS-enabled, so these are called straight from the browser.
 *
 * One scientific line is enforced here: the forecast endpoint returns a
 * short-range *weather* forecast (hours to ~16 days). Nothing in this file may
 * be presented as a long-term climate projection. See `scenario.ts` for how
 * long-horizon controls are labelled instead.
 */

import {
  ApiError,
  expectArray,
  expectObject,
  finiteOrNull,
  requestJson,
  requireNonEmpty,
  retag,
  type Envelope,
} from './client'

const GEOCODE_BASE = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive'
const FLOOD_BASE = 'https://flood-api.open-meteo.com/v1/flood'

// ── Geocoding ─────────────────────────────────────────────────────────────

export interface GeoPlace {
  id: number
  name: string
  country: string
  countryCode: string
  /** First-level administrative region, where the gazetteer has one. */
  admin1: string | null
  admin2: string | null
  latitude: number
  longitude: number
  elevationMetres: number | null
  timezone: string
  population: number | null
}

export function placeLabel(place: GeoPlace): string {
  return [place.name, place.admin1, place.country].filter(Boolean).join(', ')
}

export async function searchPlaces(
  name: string,
  options: { count?: number; signal?: AbortSignal } = {},
): Promise<Envelope<GeoPlace[]>> {
  const query = name.trim()
  if (query.length < 2) return { data: [], sourceId: 'open-meteo-geocoding', kind: 'observation', fetchedAt: new Date().toISOString(), observedAt: null }

  const count = options.count ?? 8
  const url = `${GEOCODE_BASE}?${new URLSearchParams({
    name: query,
    count: String(count),
    language: 'en',
    format: 'json',
  })}`

  const result = await requestJson<GeoPlace[]>(url, {
    cacheKey: `geocode:${query.toLowerCase()}:${count}`,
    sourceId: 'open-meteo-geocoding',
    signal: options.signal,
    // Place names don't move.
    ttlMs: 24 * 60 * 60 * 1000,
    retries: 1,
    parse: (raw) => {
      const body = expectObject(raw, 'open-meteo-geocoding', 'geocoding response')
      // Open-Meteo omits `results` entirely when nothing matched.
      if (body.results === undefined) return []
      return expectArray(body.results, 'open-meteo-geocoding', 'geocoding results')
        .map((item) => {
          const r = item as Record<string, unknown>
          const latitude = finiteOrNull(r.latitude)
          const longitude = finiteOrNull(r.longitude)
          if (latitude === null || longitude === null) return null
          return {
            id: Number(r.id),
            name: String(r.name ?? ''),
            country: String(r.country ?? ''),
            countryCode: String(r.country_code ?? ''),
            admin1: r.admin1 ? String(r.admin1) : null,
            admin2: r.admin2 ? String(r.admin2) : null,
            latitude,
            longitude,
            elevationMetres: finiteOrNull(r.elevation),
            timezone: String(r.timezone ?? 'UTC'),
            population: finiteOrNull(r.population),
          } satisfies GeoPlace
        })
        .filter((p): p is GeoPlace => p !== null)
    },
  })

  return retag(result, { kind: 'observation' })
}

// ── Current conditions + short-range forecast ────────────────────────────

export interface CurrentConditions {
  time: string
  temperature: number | null
  apparentTemperature: number | null
  relativeHumidity: number | null
  precipitation: number | null
  windSpeed: number | null
  windDirection: number | null
  cloudCover: number | null
  surfacePressure: number | null
  isDay: boolean | null
  weatherCode: number | null
  units: Record<string, string>
}

export interface DailySeries {
  date: string
  temperatureMax: number | null
  temperatureMin: number | null
  temperatureMean: number | null
  precipitationSum: number | null
  precipitationProbabilityMax: number | null
  windSpeedMax: number | null
  shortwaveRadiationSum: number | null
  et0: number | null
}

export interface HourlySeries {
  time: string
  temperature: number | null
  precipitation: number | null
  relativeHumidity: number | null
  cloudCover: number | null
  soilMoisture0to7cm: number | null
  windSpeed: number | null
}

export interface ForecastBundle {
  latitude: number
  longitude: number
  elevationMetres: number | null
  timezone: string
  timezoneAbbreviation: string
  utcOffsetSeconds: number
  current: CurrentConditions | null
  daily: DailySeries[]
  hourly: HourlySeries[]
  dailyUnits: Record<string, string>
  hourlyUnits: Record<string, string>
}

const CURRENT_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation',
  'wind_speed_10m',
  'wind_direction_10m',
  'cloud_cover',
  'surface_pressure',
  'is_day',
  'weather_code',
]

const DAILY_FIELDS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'temperature_2m_mean',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'shortwave_radiation_sum',
  'et0_fao_evapotranspiration',
]

const HOURLY_FIELDS = [
  'temperature_2m',
  'precipitation',
  'relative_humidity_2m',
  'cloud_cover',
  'soil_moisture_0_to_7cm',
  'wind_speed_10m',
]

function stringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) out[key] = String(value)
  return out
}

/** Read column `key` from an Open-Meteo block as an aligned numeric array. */
function column(block: Record<string, unknown> | undefined, key: string, length: number): (number | null)[] {
  const raw = block?.[key]
  if (!Array.isArray(raw)) return new Array(length).fill(null)
  return raw.map((v) => finiteOrNull(v))
}

function parseForecast(raw: unknown, sourceId: 'open-meteo-forecast' | 'open-meteo-archive'): ForecastBundle {
  const body = expectObject(raw, sourceId, 'forecast response')
  const latitude = finiteOrNull(body.latitude)
  const longitude = finiteOrNull(body.longitude)
  if (latitude === null || longitude === null) {
    throw new ApiError('validation', 'Response is missing the grid coordinates.', { sourceId })
  }

  const dailyBlock = body.daily as Record<string, unknown> | undefined
  const dailyTimes = Array.isArray(dailyBlock?.time) ? (dailyBlock.time as unknown[]).map(String) : []
  const dMax = column(dailyBlock, 'temperature_2m_max', dailyTimes.length)
  const dMin = column(dailyBlock, 'temperature_2m_min', dailyTimes.length)
  const dMean = column(dailyBlock, 'temperature_2m_mean', dailyTimes.length)
  const dPrecip = column(dailyBlock, 'precipitation_sum', dailyTimes.length)
  const dProb = column(dailyBlock, 'precipitation_probability_max', dailyTimes.length)
  const dWind = column(dailyBlock, 'wind_speed_10m_max', dailyTimes.length)
  const dRad = column(dailyBlock, 'shortwave_radiation_sum', dailyTimes.length)
  const dEt0 = column(dailyBlock, 'et0_fao_evapotranspiration', dailyTimes.length)

  const hourlyBlock = body.hourly as Record<string, unknown> | undefined
  const hourlyTimes = Array.isArray(hourlyBlock?.time) ? (hourlyBlock.time as unknown[]).map(String) : []
  const hTemp = column(hourlyBlock, 'temperature_2m', hourlyTimes.length)
  const hPrecip = column(hourlyBlock, 'precipitation', hourlyTimes.length)
  const hRh = column(hourlyBlock, 'relative_humidity_2m', hourlyTimes.length)
  const hCloud = column(hourlyBlock, 'cloud_cover', hourlyTimes.length)
  const hSoil = column(hourlyBlock, 'soil_moisture_0_to_7cm', hourlyTimes.length)
  const hWind = column(hourlyBlock, 'wind_speed_10m', hourlyTimes.length)

  const currentBlock = body.current as Record<string, unknown> | undefined
  const current: CurrentConditions | null = currentBlock
    ? {
        time: String(currentBlock.time ?? ''),
        temperature: finiteOrNull(currentBlock.temperature_2m),
        apparentTemperature: finiteOrNull(currentBlock.apparent_temperature),
        relativeHumidity: finiteOrNull(currentBlock.relative_humidity_2m),
        precipitation: finiteOrNull(currentBlock.precipitation),
        windSpeed: finiteOrNull(currentBlock.wind_speed_10m),
        windDirection: finiteOrNull(currentBlock.wind_direction_10m),
        cloudCover: finiteOrNull(currentBlock.cloud_cover),
        surfacePressure: finiteOrNull(currentBlock.surface_pressure),
        isDay: currentBlock.is_day === undefined ? null : Number(currentBlock.is_day) === 1,
        weatherCode: finiteOrNull(currentBlock.weather_code),
        units: stringRecord(body.current_units),
      }
    : null

  const bundle: ForecastBundle = {
    latitude,
    longitude,
    elevationMetres: finiteOrNull(body.elevation),
    timezone: String(body.timezone ?? 'UTC'),
    timezoneAbbreviation: String(body.timezone_abbreviation ?? 'UTC'),
    utcOffsetSeconds: finiteOrNull(body.utc_offset_seconds) ?? 0,
    current,
    daily: dailyTimes.map((date, i) => ({
      date,
      temperatureMax: dMax[i],
      temperatureMin: dMin[i],
      temperatureMean: dMean[i],
      precipitationSum: dPrecip[i],
      precipitationProbabilityMax: dProb[i],
      windSpeedMax: dWind[i],
      shortwaveRadiationSum: dRad[i],
      et0: dEt0[i],
    })),
    hourly: hourlyTimes.map((time, i) => ({
      time,
      temperature: hTemp[i],
      precipitation: hPrecip[i],
      relativeHumidity: hRh[i],
      cloudCover: hCloud[i],
      soilMoisture0to7cm: hSoil[i],
      windSpeed: hWind[i],
    })),
    dailyUnits: stringRecord(body.daily_units),
    hourlyUnits: stringRecord(body.hourly_units),
  }

  if (!bundle.current && bundle.daily.length === 0 && bundle.hourly.length === 0) {
    throw new ApiError('empty', 'Open-Meteo returned no current, daily or hourly values.', { sourceId })
  }
  return bundle
}

export interface ForecastRequest {
  latitude: number
  longitude: number
  /** Up to 16 on the free tier. */
  forecastDays?: number
  pastDays?: number
  includeHourly?: boolean
  includeSoilMoisture?: boolean
  signal?: AbortSignal
  bypassCache?: boolean
}

/**
 * Current conditions plus a short-range weather forecast.
 *
 * The envelope carries kind 'forecast' because the bulk of the payload is
 * forecast; `current` within it is an observation-grade value and is labelled
 * separately where it is rendered.
 */
export async function fetchForecast(request: ForecastRequest): Promise<Envelope<ForecastBundle>> {
  const {
    latitude,
    longitude,
    forecastDays = 7,
    pastDays = 0,
    includeHourly = true,
    includeSoilMoisture = false,
    signal,
    bypassCache,
  } = request

  const hourly = includeSoilMoisture ? HOURLY_FIELDS : HOURLY_FIELDS.filter((f) => !f.startsWith('soil_'))

  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: CURRENT_FIELDS.join(','),
    daily: DAILY_FIELDS.join(','),
    timezone: 'auto',
    forecast_days: String(Math.min(Math.max(forecastDays, 1), 16)),
  })
  if (pastDays > 0) params.set('past_days', String(Math.min(pastDays, 92)))
  if (includeHourly) params.set('hourly', hourly.join(','))

  const url = `${FORECAST_BASE}?${params}`
  const result = await requestJson<ForecastBundle>(url, {
    cacheKey: `om-forecast:${latitude.toFixed(3)},${longitude.toFixed(3)}:${forecastDays}:${pastDays}:${includeHourly}:${includeSoilMoisture}`,
    sourceId: 'open-meteo-forecast',
    signal,
    bypassCache,
    // Open-Meteo refreshes current conditions on a 15-minute interval.
    ttlMs: 10 * 60 * 1000,
    parse: (raw) => parseForecast(raw, 'open-meteo-forecast'),
  })

  return retag(result, {
    kind: 'forecast',
    // `current.time` is the provider's own observation stamp for the current block.
    observedAt: result.data.current?.time ?? null,
    period:
      result.data.daily.length > 0
        ? { start: result.data.daily[0].date, end: result.data.daily[result.data.daily.length - 1].date }
        : undefined,
  })
}

// ── Historical archive (ERA5 reanalysis) ─────────────────────────────────

export interface ArchiveRequest {
  latitude: number
  longitude: number
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  signal?: AbortSignal
  bypassCache?: boolean
}

export async function fetchHistorical(request: ArchiveRequest): Promise<Envelope<ForecastBundle>> {
  const { latitude, longitude, startDate, endDate, signal, bypassCache } = request

  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    start_date: startDate,
    end_date: endDate,
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'temperature_2m_mean',
      'precipitation_sum',
      'shortwave_radiation_sum',
      'et0_fao_evapotranspiration',
    ].join(','),
    timezone: 'auto',
  })

  const url = `${ARCHIVE_BASE}?${params}`
  const result = await requestJson<ForecastBundle>(url, {
    cacheKey: `om-archive:${latitude.toFixed(3)},${longitude.toFixed(3)}:${startDate}:${endDate}`,
    sourceId: 'open-meteo-archive',
    signal,
    bypassCache,
    // The archive is immutable for closed periods; cache hard.
    ttlMs: 6 * 60 * 60 * 1000,
    timeoutMs: 40_000,
    parse: (raw) => parseForecast(raw, 'open-meteo-archive'),
  })

  return retag(result, {
    kind: 'historical',
    observedAt: null,
    period: { start: startDate, end: endDate },
    notes: [
      'ERA5 reanalysis: a model-assimilated gridded record, not a single station reading.',
    ],
  })
}

/** Monthly means over N whole years ending last completed year. */
export interface MonthlyClimateRow {
  month: string // YYYY-MM
  temperatureMean: number | null
  precipitationSum: number | null
}

export function toMonthly(daily: DailySeries[]): MonthlyClimateRow[] {
  const buckets = new Map<string, { temps: number[]; precip: number[] }>()
  for (const row of daily) {
    const month = row.date.slice(0, 7)
    const bucket = buckets.get(month) ?? { temps: [], precip: [] }
    const mean =
      row.temperatureMean ??
      (row.temperatureMax !== null && row.temperatureMin !== null
        ? (row.temperatureMax + row.temperatureMin) / 2
        : null)
    if (mean !== null) bucket.temps.push(mean)
    if (row.precipitationSum !== null) bucket.precip.push(row.precipitationSum)
    buckets.set(month, bucket)
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({
      month,
      temperatureMean:
        bucket.temps.length > 0 ? bucket.temps.reduce((a, b) => a + b, 0) / bucket.temps.length : null,
      // A month with partial coverage is reported as a sum of what exists;
      // callers that need completeness check the day count themselves.
      precipitationSum: bucket.precip.length > 0 ? bucket.precip.reduce((a, b) => a + b, 0) : null,
    }))
}

// ── GloFAS river discharge (Flood API) ───────────────────────────────────

export interface DischargeDay {
  date: string
  discharge: number | null
  dischargeMean: number | null
  dischargeMax: number | null
  dischargeMin: number | null
}

export interface FloodBundle {
  latitude: number
  longitude: number
  unit: string
  days: DischargeDay[]
  /** True when the grid cell carries no modelled river — every value is null. */
  noRiverCell: boolean
}

export async function fetchRiverDischarge(request: {
  latitude: number
  longitude: number
  forecastDays?: number
  pastDays?: number
  signal?: AbortSignal
  bypassCache?: boolean
}): Promise<Envelope<FloodBundle>> {
  const { latitude, longitude, forecastDays = 14, pastDays = 30, signal, bypassCache } = request

  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    daily: ['river_discharge', 'river_discharge_mean', 'river_discharge_max', 'river_discharge_min'].join(','),
    forecast_days: String(Math.min(forecastDays, 210)),
    past_days: String(Math.min(pastDays, 90)),
  })

  const url = `${FLOOD_BASE}?${params}`
  const result = await requestJson<FloodBundle>(url, {
    cacheKey: `om-flood:${latitude.toFixed(3)},${longitude.toFixed(3)}:${forecastDays}:${pastDays}`,
    sourceId: 'open-meteo-flood',
    signal,
    bypassCache,
    ttlMs: 60 * 60 * 1000,
    parse: (raw) => {
      const body = expectObject(raw, 'open-meteo-flood', 'flood response')
      const block = body.daily as Record<string, unknown> | undefined
      const times = Array.isArray(block?.time) ? (block.time as unknown[]).map(String) : []
      requireNonEmpty(times, 'open-meteo-flood', 'discharge days')

      const discharge = column(block, 'river_discharge', times.length)
      const mean = column(block, 'river_discharge_mean', times.length)
      const max = column(block, 'river_discharge_max', times.length)
      const min = column(block, 'river_discharge_min', times.length)

      const days: DischargeDay[] = times.map((date, i) => ({
        date,
        discharge: discharge[i],
        dischargeMean: mean[i],
        dischargeMax: max[i],
        dischargeMin: min[i],
      }))

      return {
        latitude: finiteOrNull(body.latitude) ?? latitude,
        longitude: finiteOrNull(body.longitude) ?? longitude,
        unit: stringRecord(body.daily_units).river_discharge ?? 'm³/s',
        days,
        // GloFAS returns the array shape but all-null values off-river.
        noRiverCell: days.every((d) => d.discharge === null && d.dischargeMean === null),
      }
    },
  })

  return retag(result, {
    kind: 'forecast',
    observedAt: null,
    period: { start: result.data.days[0].date, end: result.data.days[result.data.days.length - 1].date },
    notes: result.data.noRiverCell
      ? ['The GloFAS grid cell for this point carries no modelled river channel, so no discharge is available here.']
      : ['Discharge before today is a GloFAS reanalysis value; from today onward it is a forecast.'],
  })
}

/** WMO weather interpretation codes, used for the current-conditions label. */
export const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snowfall',
  73: 'Moderate snowfall',
  75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
}

export function describeWeatherCode(code: number | null): string | null {
  if (code === null) return null
  return WEATHER_CODES[code] ?? `WMO code ${code}`
}
