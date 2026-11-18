/**
 * USGS National Water Information System — instantaneous-values service.
 *
 * Coverage is the United States and its territories only. For anywhere else
 * this returns an 'unsupported-location' error rather than a substitute value,
 * and the UI says so.
 *
 * Readings are flagged provisional by USGS and subject to revision; that flag
 * is carried through to the UI rather than being dropped.
 */

import { ApiError, expectArray, expectObject, finiteOrNull, requestJson, retag, type Envelope } from './client'
import { cfsToCumecs, feetToMetres } from '../data/normalizers/units'

const NWIS_IV = 'https://waterservices.usgs.gov/nwis/iv/'

/** The two parameter codes this app uses. */
export const PARAMETER_CODES = {
  discharge: '00060', // cubic feet per second
  gaugeHeight: '00065', // feet
} as const

export interface StationReading {
  /** The provider's own observation timestamp. */
  dateTime: string
  value: number
  /** USGS qualifier codes: 'P' provisional, 'A' approved, 'e' estimated. */
  qualifiers: string[]
}

export interface StationSeries {
  parameterCode: string
  parameterName: string
  /** Unit exactly as USGS reports it. */
  unit: string
  latest: StationReading | null
  readings: StationReading[]
  /** Converted to SI for the 3D scene; the UI still shows the native unit. */
  latestSi: { value: number; unit: string } | null
}

export interface WaterStation {
  siteCode: string
  siteName: string
  latitude: number | null
  longitude: number | null
  /** Straight-line distance from the selected location, km. */
  distanceKm: number | null
  series: StationSeries[]
  /** True if any reading in any series is flagged provisional. */
  provisional: boolean
}

export interface UsgsBundle {
  stations: WaterStation[]
  disclaimer: string | null
  bbox: { west: number; south: number; east: number; north: number }
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Rough continental-US + Alaska/Hawaii/PR envelope, to fail fast off-coverage. */
export function withinUsgsCoverage(latitude: number, longitude: number): boolean {
  const boxes = [
    { s: 24.0, n: 49.5, w: -125.5, e: -66.5 }, // CONUS
    { s: 51.0, n: 71.5, w: -170.0, e: -129.0 }, // Alaska
    { s: 18.5, n: 22.5, w: -160.5, e: -154.5 }, // Hawaii
    { s: 17.6, n: 18.6, w: -67.5, e: -65.0 }, // Puerto Rico
    { s: 13.2, n: 13.7, w: 144.5, e: 145.0 }, // Guam
  ]
  return boxes.some((b) => latitude >= b.s && latitude <= b.n && longitude >= b.w && longitude <= b.e)
}

function toSi(parameterCode: string, value: number, unit: string): { value: number; unit: string } | null {
  if (parameterCode === PARAMETER_CODES.discharge && /ft3\/s/i.test(unit)) {
    return { value: cfsToCumecs(value), unit: 'm³/s' }
  }
  if (parameterCode === PARAMETER_CODES.gaugeHeight && /^ft$/i.test(unit.trim())) {
    return { value: feetToMetres(value), unit: 'm' }
  }
  return null
}

export interface UsgsRequest {
  latitude: number
  longitude: number
  /** Half-width of the search box in degrees. NWIS caps bBox span at 25°. */
  radiusDegrees?: number
  /** ISO-8601 duration for the lookback window, e.g. 'P7D'. */
  period?: string
  maxStations?: number
  signal?: AbortSignal
  bypassCache?: boolean
}

export async function fetchWaterStations(request: UsgsRequest): Promise<Envelope<UsgsBundle>> {
  const {
    latitude,
    longitude,
    radiusDegrees = 0.5,
    period = 'P7D',
    maxStations = 8,
    signal,
    bypassCache,
  } = request

  if (!withinUsgsCoverage(latitude, longitude)) {
    throw new ApiError(
      'unsupported-location',
      'USGS gauges cover the United States and its territories only. The selected location is outside that network.',
      { sourceId: 'usgs-nwis' },
    )
  }

  const west = longitude - radiusDegrees
  const east = longitude + radiusDegrees
  const south = latitude - radiusDegrees
  const north = latitude + radiusDegrees

  const params = new URLSearchParams({
    format: 'json',
    bBox: [west, south, east, north].map((v) => v.toFixed(4)).join(','),
    parameterCd: `${PARAMETER_CODES.discharge},${PARAMETER_CODES.gaugeHeight}`,
    siteStatus: 'active',
    period,
  })

  const url = `${NWIS_IV}?${params}`

  const result = await requestJson<UsgsBundle>(url, {
    cacheKey: `usgs:${latitude.toFixed(3)},${longitude.toFixed(3)}:${radiusDegrees}:${period}`,
    sourceId: 'usgs-nwis',
    signal,
    bypassCache,
    // Instantaneous values update every 15 minutes upstream.
    ttlMs: 10 * 60 * 1000,
    timeoutMs: 40_000,
    parse: (raw) => {
      const body = expectObject(raw, 'usgs-nwis', 'NWIS response')
      const value = expectObject(body.value, 'usgs-nwis', 'value')
      const timeSeries = expectArray(value.timeSeries ?? [], 'usgs-nwis', 'timeSeries')

      const notes = (value.queryInfo as { note?: { value?: string; title?: string }[] } | undefined)?.note ?? []
      const disclaimer = notes.find((n) => n.title === 'disclaimer')?.value ?? null

      // NWIS returns one timeSeries per site × parameter; regroup by site.
      const bySite = new Map<string, WaterStation>()

      for (const entry of timeSeries) {
        const ts = entry as Record<string, unknown>
        const sourceInfo = (ts.sourceInfo ?? {}) as Record<string, unknown>
        const codes = (sourceInfo.siteCode ?? []) as { value?: string }[]
        const siteCode = codes[0]?.value
        if (!siteCode) continue

        const geo = ((sourceInfo.geoLocation ?? {}) as Record<string, unknown>).geogLocation as
          | Record<string, unknown>
          | undefined

        const variable = (ts.variable ?? {}) as Record<string, unknown>
        const variableCodes = (variable.variableCode ?? []) as { value?: string }[]
        const parameterCode = variableCodes[0]?.value ?? ''
        const unit = String(((variable.unit ?? {}) as Record<string, unknown>).unitCode ?? '')
        const parameterName = String(variable.variableName ?? parameterCode)
        const noDataValue = finiteOrNull(variable.noDataValue)

        const valueBlocks = (ts.values ?? []) as { value?: Record<string, unknown>[] }[]
        const readings: StationReading[] = []
        for (const block of valueBlocks) {
          for (const point of block.value ?? []) {
            const n = finiteOrNull(point.value)
            if (n === null || (noDataValue !== null && n === noDataValue)) continue
            readings.push({
              dateTime: String(point.dateTime ?? ''),
              value: n,
              qualifiers: Array.isArray(point.qualifiers) ? point.qualifiers.map(String) : [],
            })
          }
        }
        readings.sort((a, b) => a.dateTime.localeCompare(b.dateTime))
        if (readings.length === 0) continue

        const latest = readings[readings.length - 1]
        const siteLat = finiteOrNull(geo?.latitude)
        const siteLon = finiteOrNull(geo?.longitude)

        const station =
          bySite.get(siteCode) ??
          ({
            siteCode,
            siteName: String(sourceInfo.siteName ?? siteCode),
            latitude: siteLat,
            longitude: siteLon,
            distanceKm:
              siteLat !== null && siteLon !== null ? haversineKm(latitude, longitude, siteLat, siteLon) : null,
            series: [],
            provisional: false,
          } satisfies WaterStation)

        station.series.push({
          parameterCode,
          // NWIS variable names are verbose; trim the trailing qualifier.
          parameterName: parameterName.replace(/,\s*$/, ''),
          unit,
          latest,
          readings,
          latestSi: toSi(parameterCode, latest.value, unit),
        })
        if (readings.some((r) => r.qualifiers.includes('P'))) station.provisional = true
        bySite.set(siteCode, station)
      }

      const stations = [...bySite.values()]
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
        .slice(0, maxStations)

      if (stations.length === 0) {
        throw new ApiError(
          'empty',
          'No active USGS gauge within the search area reported discharge or gauge height for this period.',
          { sourceId: 'usgs-nwis' },
        )
      }

      return { stations, disclaimer, bbox: { west, south, east, north } }
    },
  })

  // The newest reading across all stations is the honest observation time.
  const newest = result.data.stations
    .flatMap((s) => s.series.map((series) => series.latest?.dateTime))
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop()

  return retag(result, {
    kind: 'observation',
    observedAt: newest ?? null,
    notes: [
      ...(result.data.disclaimer ? [result.data.disclaimer] : []),
      ...(result.data.stations.some((s) => s.provisional)
        ? ['Readings flagged "P" are provisional and subject to revision by USGS.']
        : []),
    ],
  })
}
