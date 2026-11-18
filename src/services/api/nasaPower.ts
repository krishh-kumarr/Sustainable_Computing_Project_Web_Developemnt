/**
 * NASA POWER — solar irradiance and meteorology on a ~0.5° satellite-derived,
 * model-assimilated grid. Keyless and CORS-enabled.
 *
 * Everything here is HISTORICAL: POWER's daily record lags real time by several
 * days, so no value from this file may be labelled as a live observation.
 */

import {
  ApiError,
  expectObject,
  finiteExcept,
  requestJson,
  retag,
  type Envelope,
} from './client'
import { mjPerM2DayToKwhPerM2Day } from '../data/normalizers/units'

const POWER_BASE = 'https://power.larc.nasa.gov/api/temporal/daily/point'

/** The parameters we request, with the units POWER documents for each. */
export const POWER_PARAMETERS = {
  ALLSKY_SFC_SW_DWN: { label: 'All-sky surface shortwave downward irradiance', unit: 'MJ/m²/day' },
  CLRSKY_SFC_SW_DWN: { label: 'Clear-sky surface shortwave downward irradiance', unit: 'MJ/m²/day' },
  T2M: { label: 'Temperature at 2 metres', unit: '°C' },
  T2M_MAX: { label: 'Maximum temperature at 2 metres', unit: '°C' },
  T2M_MIN: { label: 'Minimum temperature at 2 metres', unit: '°C' },
  RH2M: { label: 'Relative humidity at 2 metres', unit: '%' },
  PRECTOTCORR: { label: 'Precipitation (bias corrected)', unit: 'mm/day' },
  WS2M: { label: 'Wind speed at 2 metres', unit: 'm/s' },
} as const

export type PowerParameter = keyof typeof POWER_PARAMETERS

export interface PowerDay {
  /** ISO date, converted from POWER's YYYYMMDD keys. */
  date: string
  values: Partial<Record<PowerParameter, number | null>>
}

export interface PowerBundle {
  latitude: number
  longitude: number
  elevationMetres: number | null
  /** POWER's own unit strings, taken from the response rather than assumed. */
  units: Partial<Record<PowerParameter, string>>
  longNames: Partial<Record<PowerParameter, string>>
  /** Which upstream datasets POWER drew on (e.g. MERRA2, SYN1DEG). */
  sources: string[]
  days: PowerDay[]
  /** Daily mean solar irradiance over the period, in kWh/m²/day. */
  meanIrradianceKwh: number | null
  /** Days POWER filled with its -999 sentinel, i.e. genuinely missing. */
  missingDayCount: number
}

function isoFromPowerKey(key: string): string {
  // POWER keys daily values as YYYYMMDD.
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`
}

export interface PowerRequest {
  latitude: number
  longitude: number
  /** YYYYMMDD */
  start: string
  /** YYYYMMDD */
  end: string
  parameters?: PowerParameter[]
  /** AG = agroclimatology, RE = renewable energy, SB = sustainable buildings. */
  community?: 'AG' | 'RE' | 'SB'
  signal?: AbortSignal
  bypassCache?: boolean
}

export async function fetchPowerDaily(request: PowerRequest): Promise<Envelope<PowerBundle>> {
  const {
    latitude,
    longitude,
    start,
    end,
    parameters = ['ALLSKY_SFC_SW_DWN', 'T2M', 'PRECTOTCORR', 'RH2M'],
    community = 'AG',
    signal,
    bypassCache,
  } = request

  const params = new URLSearchParams({
    parameters: parameters.join(','),
    community,
    longitude: longitude.toFixed(4),
    latitude: latitude.toFixed(4),
    start,
    end,
    format: 'JSON',
  })

  const url = `${POWER_BASE}?${params}`
  const result = await requestJson<PowerBundle>(url, {
    cacheKey: `power:${latitude.toFixed(3)},${longitude.toFixed(3)}:${start}:${end}:${parameters.join('|')}:${community}`,
    sourceId: 'nasa-power',
    signal,
    bypassCache,
    // POWER is slow and the record is closed for past periods.
    ttlMs: 12 * 60 * 60 * 1000,
    timeoutMs: 45_000,
    retries: 1,
    parse: (raw) => {
      const body = expectObject(raw, 'nasa-power', 'POWER response')
      const properties = expectObject(body.properties, 'nasa-power', 'properties')
      const parameterBlock = expectObject(properties.parameter, 'nasa-power', 'properties.parameter')
      const header = (body.header ?? {}) as Record<string, unknown>
      const fillValue = typeof header.fill_value === 'number' ? header.fill_value : -999

      // Union of all date keys across the requested parameters.
      const dateKeys = new Set<string>()
      for (const series of Object.values(parameterBlock)) {
        if (series && typeof series === 'object') {
          for (const key of Object.keys(series as Record<string, unknown>)) dateKeys.add(key)
        }
      }
      if (dateKeys.size === 0) {
        throw new ApiError('empty', 'NASA POWER returned no days for this period.', { sourceId: 'nasa-power' })
      }

      let missingDayCount = 0
      const days: PowerDay[] = [...dateKeys]
        .sort()
        .map((key) => {
          const values: PowerDay['values'] = {}
          let anyMissing = false
          for (const name of parameters) {
            const series = parameterBlock[name] as Record<string, unknown> | undefined
            const value = finiteExcept(series?.[key], fillValue)
            values[name] = value
            if (value === null) anyMissing = true
          }
          if (anyMissing) missingDayCount++
          return { date: isoFromPowerKey(key), values }
        })

      const parameterMeta = (body.parameters ?? {}) as Record<string, { units?: string; longname?: string }>
      const units: PowerBundle['units'] = {}
      const longNames: PowerBundle['longNames'] = {}
      for (const name of parameters) {
        units[name] = parameterMeta[name]?.units ?? POWER_PARAMETERS[name].unit
        longNames[name] = parameterMeta[name]?.longname ?? POWER_PARAMETERS[name].label
      }

      const irradianceDays = days
        .map((d) => d.values.ALLSKY_SFC_SW_DWN)
        .filter((v): v is number => v !== null && v !== undefined)
      const meanIrradianceKwh =
        irradianceDays.length > 0
          ? mjPerM2DayToKwhPerM2Day(irradianceDays.reduce((a, b) => a + b, 0) / irradianceDays.length)
          : null

      const geometry = (body.geometry ?? {}) as { coordinates?: unknown }
      const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : []

      return {
        latitude: finiteExcept(coords[1], fillValue) ?? latitude,
        longitude: finiteExcept(coords[0], fillValue) ?? longitude,
        elevationMetres: finiteExcept(coords[2], fillValue),
        units,
        longNames,
        sources: Array.isArray(header.sources) ? header.sources.map(String) : [],
        days,
        meanIrradianceKwh,
        missingDayCount,
      }
    },
  })

  return retag(result, {
    kind: 'historical',
    observedAt: null,
    period: { start: isoFromPowerKey(start), end: isoFromPowerKey(end) },
    notes: [
      `Grid-cell values from ${result.data.sources.join(', ') || 'NASA POWER'}, not a point measurement.`,
      ...(result.data.missingDayCount > 0
        ? [`${result.data.missingDayCount} day(s) in this period have no value and are omitted from averages.`]
        : []),
    ],
  })
}

/** POWER's daily record is not current; keep requests inside its coverage. */
export function powerSafeDateRange(daysBack: number, lagDays = 7): { start: string; end: string } {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - lagDays)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - daysBack)
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  return { start: fmt(start), end: fmt(end) }
}
