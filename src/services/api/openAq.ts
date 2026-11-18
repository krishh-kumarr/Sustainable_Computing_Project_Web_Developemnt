/**
 * OpenAQ v3 — aggregated air-quality monitor readings.
 *
 * Reached through our own proxy (`/api/openaq/...`) because v3 requires an
 * X-API-Key header, and a key placed in the frontend bundle is a published key.
 *
 * Two coverage facts are enforced throughout: not every city has a monitor,
 * and no monitor measures every pollutant. Missing pollutants are returned as
 * explicitly absent rather than as zero or an interpolated guess.
 */

import { ApiError, expectArray, expectObject, finiteOrNull, requestJson, retag, type Envelope } from './client'

const PROXY_BASE = '/api/openaq'

/** Pollutants this app surfaces, with the canonical display order. */
export const TRACKED_POLLUTANTS = ['pm25', 'pm10', 'no2', 'o3', 'co', 'so2'] as const
export type Pollutant = (typeof TRACKED_POLLUTANTS)[number]

export const POLLUTANT_LABEL: Record<Pollutant, string> = {
  pm25: 'PM2.5',
  pm10: 'PM10',
  no2: 'NO₂',
  o3: 'O₃',
  co: 'CO',
  so2: 'SO₂',
}

export const POLLUTANT_DESCRIPTION: Record<Pollutant, string> = {
  pm25: 'Fine particulate matter under 2.5 µm — penetrates deep into the lungs.',
  pm10: 'Coarse particulate matter under 10 µm — dust, pollen, combustion particles.',
  no2: 'Nitrogen dioxide — largely from traffic and combustion.',
  o3: 'Ground-level ozone — formed photochemically, peaks on sunny afternoons.',
  co: 'Carbon monoxide — incomplete combustion.',
  so2: 'Sulphur dioxide — fuel sulphur, industry and shipping.',
}

export interface Sensor {
  sensorId: number
  parameter: Pollutant | string
  parameterDisplayName: string
  /** Unit exactly as OpenAQ reports it; never assumed. */
  unit: string
}

export interface MonitorStation {
  locationId: number
  name: string
  locality: string | null
  countryName: string | null
  countryCode: string | null
  latitude: number | null
  longitude: number | null
  distanceKm: number | null
  timezone: string | null
  provider: string | null
  /** OpenAQ distinguishes reference monitors from low-cost sensor nodes. */
  isMonitor: boolean | null
  isMobile: boolean | null
  sensors: Sensor[]
  /** Provider's timestamp for the most recent datum at this station. */
  lastReportedUtc: string | null
  firstReportedUtc: string | null
}

export interface PollutantReading {
  parameter: string
  displayName: string
  value: number
  unit: string
  /** The provider's own measurement timestamp — not our fetch time. */
  measuredAtUtc: string
  measuredAtLocal: string | null
  sensorId: number
}

export interface AirQualitySnapshot {
  station: MonitorStation
  readings: PollutantReading[]
  /** Pollutants this station has no sensor for, so cannot report at all. */
  unmonitoredPollutants: Pollutant[]
  /** Pollutants it has a sensor for that returned no current value. */
  silentPollutants: Pollutant[]
  /** Newest measurement timestamp across all readings. */
  newestMeasurementUtc: string | null
}

export interface StationSearchResult {
  stations: MonitorStation[]
  searchRadiusMetres: number
  centre: { latitude: number; longitude: number }
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

function parseSensors(raw: unknown): Sensor[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const s = item as Record<string, unknown>
      const parameter = (s.parameter ?? {}) as Record<string, unknown>
      const name = str(parameter.name)
      if (!name) return null
      return {
        sensorId: Number(s.id),
        parameter: name,
        parameterDisplayName: str(parameter.displayName) ?? name,
        unit: str(parameter.units) ?? '',
      } satisfies Sensor
    })
    .filter((s): s is Sensor => s !== null)
}

function parseStation(raw: unknown, centre: { latitude: number; longitude: number }): MonitorStation | null {
  const r = raw as Record<string, unknown>
  const id = finiteOrNull(r.id)
  if (id === null) return null
  const coordinates = (r.coordinates ?? {}) as Record<string, unknown>
  const latitude = finiteOrNull(coordinates.latitude)
  const longitude = finiteOrNull(coordinates.longitude)
  const country = (r.country ?? {}) as Record<string, unknown>
  const provider = (r.provider ?? {}) as Record<string, unknown>
  const last = (r.datetimeLast ?? {}) as Record<string, unknown>
  const first = (r.datetimeFirst ?? {}) as Record<string, unknown>

  return {
    locationId: id,
    name: str(r.name) ?? `Location ${id}`,
    locality: str(r.locality),
    countryName: str(country.name),
    countryCode: str(country.code),
    latitude,
    longitude,
    distanceKm:
      latitude !== null && longitude !== null
        ? haversineKm(centre.latitude, centre.longitude, latitude, longitude)
        : null,
    timezone: str(r.timezone),
    provider: str(provider.name),
    isMonitor: r.isMonitor === undefined || r.isMonitor === null ? null : Boolean(r.isMonitor),
    isMobile: r.isMobile === undefined || r.isMobile === null ? null : Boolean(r.isMobile),
    sensors: parseSensors(r.sensors),
    lastReportedUtc: str(last.utc),
    firstReportedUtc: str(first.utc),
  }
}

/** Find monitoring stations near a point. */
export async function findStations(request: {
  latitude: number
  longitude: number
  radiusMetres?: number
  limit?: number
  signal?: AbortSignal
  bypassCache?: boolean
}): Promise<Envelope<StationSearchResult>> {
  // OpenAQ caps `radius` at 25 000 m.
  const radius = Math.min(request.radiusMetres ?? 25_000, 25_000)
  const limit = Math.min(request.limit ?? 50, 100)
  const centre = { latitude: request.latitude, longitude: request.longitude }

  const params = new URLSearchParams({
    coordinates: `${request.latitude.toFixed(5)},${request.longitude.toFixed(5)}`,
    radius: String(Math.round(radius)),
    limit: String(limit),
  })

  const result = await requestJson<StationSearchResult>(`${PROXY_BASE}/locations?${params}`, {
    cacheKey: `openaq-stations:${request.latitude.toFixed(3)},${request.longitude.toFixed(3)}:${radius}:${limit}`,
    sourceId: 'openaq',
    signal: request.signal,
    bypassCache: request.bypassCache,
    ttlMs: 30 * 60 * 1000,
    parse: (raw) => {
      const body = expectObject(raw, 'openaq', 'locations response')
      const results = expectArray(body.results ?? [], 'openaq', 'locations results')
      const stations = results
        .map((item) => parseStation(item, centre))
        .filter((s): s is MonitorStation => s !== null)
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))

      if (stations.length === 0) {
        throw new ApiError(
          'empty',
          `No OpenAQ monitoring station found within ${Math.round(radius / 1000)} km of this location.`,
          { sourceId: 'openaq' },
        )
      }
      return { stations, searchRadiusMetres: radius, centre }
    },
  })

  const newest = result.data.stations
    .map((s) => s.lastReportedUtc)
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop()

  return retag(result, { kind: 'observation', observedAt: newest ?? null })
}

/** Latest value per sensor at one station. */
export async function fetchLatestForStation(request: {
  station: MonitorStation
  signal?: AbortSignal
  bypassCache?: boolean
}): Promise<Envelope<AirQualitySnapshot>> {
  const { station, signal, bypassCache } = request
  const sensorById = new Map(station.sensors.map((s) => [s.sensorId, s]))

  const result = await requestJson<AirQualitySnapshot>(
    `${PROXY_BASE}/latest/${station.locationId}?limit=100`,
    {
      cacheKey: `openaq-latest:${station.locationId}`,
      sourceId: 'openaq',
      signal,
      bypassCache,
      // Most providers push hourly; 10 minutes keeps navigation cheap.
      ttlMs: 10 * 60 * 1000,
      parse: (raw) => {
        const body = expectObject(raw, 'openaq', 'latest response')
        const results = expectArray(body.results ?? [], 'openaq', 'latest results')

        const readings: PollutantReading[] = results
          .map((item) => {
            const r = item as Record<string, unknown>
            const value = finiteOrNull(r.value)
            const sensorId = finiteOrNull(r.sensorsId)
            if (value === null || sensorId === null) return null
            const sensor = sensorById.get(sensorId)
            // Without the sensor record we cannot name the pollutant or its
            // unit, and guessing either would be fabrication.
            if (!sensor) return null
            const datetime = (r.datetime ?? {}) as Record<string, unknown>
            const measuredAtUtc = str(datetime.utc)
            if (!measuredAtUtc) return null
            return {
              parameter: sensor.parameter,
              displayName: sensor.parameterDisplayName,
              value,
              unit: sensor.unit,
              measuredAtUtc,
              measuredAtLocal: str(datetime.local),
              sensorId,
            } satisfies PollutantReading
          })
          .filter((r): r is PollutantReading => r !== null)

        if (readings.length === 0) {
          throw new ApiError(
            'empty',
            `${station.name} has sensors registered but reported no current values.`,
            { sourceId: 'openaq' },
          )
        }

        const sensorParameters = new Set(station.sensors.map((s) => s.parameter))
        const reported = new Set(readings.map((r) => r.parameter))

        const newest = readings
          .map((r) => r.measuredAtUtc)
          .sort()
          .pop() ?? null

        return {
          station,
          readings: readings.sort((a, b) => {
            const ai = (TRACKED_POLLUTANTS as readonly string[]).indexOf(a.parameter)
            const bi = (TRACKED_POLLUTANTS as readonly string[]).indexOf(b.parameter)
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
          }),
          unmonitoredPollutants: TRACKED_POLLUTANTS.filter((p) => !sensorParameters.has(p)),
          silentPollutants: TRACKED_POLLUTANTS.filter((p) => sensorParameters.has(p) && !reported.has(p)),
          newestMeasurementUtc: newest,
        }
      },
    },
  )

  return retag(result, {
    kind: 'observation',
    observedAt: result.data.newestMeasurementUtc,
    notes: [
      ...(result.data.unmonitoredPollutants.length > 0
        ? [
            `This station has no sensor for ${result.data.unmonitoredPollutants
              .map((p) => POLLUTANT_LABEL[p])
              .join(', ')}.`,
          ]
        : []),
      ...(result.data.silentPollutants.length > 0
        ? [
            `Sensors exist but reported no current value for ${result.data.silentPollutants
              .map((p) => POLLUTANT_LABEL[p])
              .join(', ')}.`,
          ]
        : []),
    ],
  })
}

/** How old is a reading, in hours? Drives the "stale reading" warning. */
export function readingAgeHours(measuredAtUtc: string): number | null {
  const t = Date.parse(measuredAtUtc)
  if (!Number.isFinite(t)) return null
  return (Date.now() - t) / 3_600_000
}
