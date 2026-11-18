/**
 * NASA FIRMS active-fire detections, via our proxy (the map key is a
 * credential and stays server-side; the proxy also converts FIRMS' CSV to
 * typed JSON).
 *
 * Terminology discipline: FIRMS returns *detections* — pixels where a satellite
 * radiometer measured a thermal anomaly consistent with active burning. They
 * are not confirmed ground fires. Equally, no detections in an area is not
 * evidence of no fire: cloud cover, overpass timing and small or cool fires all
 * produce silence.
 */

import { ApiError, expectArray, expectObject, finiteOrNull, requestJson, retag, type Envelope } from './client'

/** FIRMS products, newest-generation first. */
export const FIRMS_SOURCES = {
  VIIRS_SNPP_NRT: { label: 'VIIRS (Suomi NPP), near real-time', resolutionMetres: 375 },
  VIIRS_NOAA20_NRT: { label: 'VIIRS (NOAA-20), near real-time', resolutionMetres: 375 },
  VIIRS_NOAA21_NRT: { label: 'VIIRS (NOAA-21), near real-time', resolutionMetres: 375 },
  MODIS_NRT: { label: 'MODIS (Terra & Aqua), near real-time', resolutionMetres: 1000 },
} as const

export type FirmsSource = keyof typeof FIRMS_SOURCES

export interface FireDetection {
  latitude: number
  longitude: number
  /** Brightness temperature of the anomaly, kelvin (VIIRS I-4 / MODIS band 21). */
  brightnessKelvin: number | null
  /** Fire Radiative Power, megawatts. Absent for some products and rows. */
  frpMegawatts: number | null
  /** Acquisition date (UTC), as FIRMS reports it. */
  acquisitionDate: string | null
  /** Acquisition time (UTC), HHMM. */
  acquisitionTime: string | null
  /** Combined ISO timestamp, when both parts are present. */
  acquiredAtUtc: string | null
  satellite: string | null
  instrument: string | null
  /**
   * VIIRS: 'l' (low) | 'n' (nominal) | 'h' (high) — a detection-confidence
   * class, NOT a probability that something is burning.
   * MODIS: an integer 0–100 confidence value.
   */
  confidenceRaw: string | null
  confidenceClass: 'low' | 'nominal' | 'high' | 'unknown'
  dayNight: 'day' | 'night' | 'unknown'
  version: string | null
}

export interface FireBundle {
  source: FirmsSource
  sourceLabel: string
  resolutionMetres: number
  /** Lookback window honoured by FIRMS, in days (1–10). */
  days: number
  bbox: { west: number; south: number; east: number; north: number }
  detections: FireDetection[]
  /** Counts by confidence class — the only legitimate way to aggregate these. */
  byConfidence: { low: number; nominal: number; high: number; unknown: number }
  /** Sum of Fire Radiative Power across detections that reported it, MW. */
  totalFrpMegawatts: number | null
  detectionsWithFrp: number
  /** Newest acquisition timestamp in the set. */
  newestAcquisitionUtc: string | null
  retrievedAt: string
}

function confidenceClass(raw: string | null): FireDetection['confidenceClass'] {
  if (raw === null) return 'unknown'
  const value = raw.trim().toLowerCase()
  if (value === 'l' || value === 'low') return 'low'
  if (value === 'n' || value === 'nominal') return 'nominal'
  if (value === 'h' || value === 'high') return 'high'
  // MODIS reports a 0-100 integer; map to FIRMS' own documented bands.
  const n = Number(value)
  if (Number.isFinite(n)) {
    if (n < 30) return 'low'
    if (n < 80) return 'nominal'
    return 'high'
  }
  return 'unknown'
}

function toIsoUtc(date: string | null, time: string | null): string | null {
  if (!date) return null
  if (!time) return `${date}T00:00:00Z`
  const padded = time.padStart(4, '0')
  return `${date}T${padded.slice(0, 2)}:${padded.slice(2, 4)}:00Z`
}

export interface FireRequest {
  latitude: number
  longitude: number
  /** Half-width of the query box in degrees. */
  radiusDegrees?: number
  days?: number
  source?: FirmsSource
  signal?: AbortSignal
  bypassCache?: boolean
}

export async function fetchFireDetections(request: FireRequest): Promise<Envelope<FireBundle>> {
  const {
    latitude,
    longitude,
    radiusDegrees = 1.5,
    days = 3,
    source = 'VIIRS_SNPP_NRT',
    signal,
    bypassCache,
  } = request

  const bbox = {
    west: longitude - radiusDegrees,
    south: latitude - radiusDegrees,
    east: longitude + radiusDegrees,
    north: latitude + radiusDegrees,
  }

  const params = new URLSearchParams({
    west: bbox.west.toFixed(4),
    south: bbox.south.toFixed(4),
    east: bbox.east.toFixed(4),
    north: bbox.north.toFixed(4),
    days: String(Math.min(Math.max(days, 1), 10)),
    source,
  })

  const result = await requestJson<FireBundle>(`/api/firms/area?${params}`, {
    cacheKey: `firms:${latitude.toFixed(2)},${longitude.toFixed(2)}:${radiusDegrees}:${days}:${source}`,
    sourceId: 'nasa-firms',
    signal,
    bypassCache,
    // FIRMS near-real-time updates roughly every 3 hours and the API enforces
    // a transaction limit, so cache generously.
    ttlMs: 30 * 60 * 1000,
    timeoutMs: 45_000,
    retries: 1,
    parse: (raw) => {
      const body = expectObject(raw, 'nasa-firms', 'FIRMS response')
      const rows = expectArray(body.detections ?? [], 'nasa-firms', 'detections')

      const detections: FireDetection[] = rows
        .map((item) => {
          const r = item as Record<string, unknown>
          const lat = finiteOrNull(r.latitude)
          const lon = finiteOrNull(r.longitude)
          if (lat === null || lon === null) return null
          const acquisitionDate = r.acquisitionDate ? String(r.acquisitionDate) : null
          const acquisitionTime = r.acquisitionTime ? String(r.acquisitionTime) : null
          const confidenceRaw = r.confidence === null || r.confidence === undefined ? null : String(r.confidence)
          const dayNightRaw = r.dayNight ? String(r.dayNight).toUpperCase() : ''
          return {
            latitude: lat,
            longitude: lon,
            brightnessKelvin: finiteOrNull(r.brightnessKelvin),
            frpMegawatts: finiteOrNull(r.frpMegawatts),
            acquisitionDate,
            acquisitionTime,
            acquiredAtUtc: toIsoUtc(acquisitionDate, acquisitionTime),
            satellite: r.satellite ? String(r.satellite) : null,
            instrument: r.instrument ? String(r.instrument) : null,
            confidenceRaw,
            confidenceClass: confidenceClass(confidenceRaw),
            dayNight: dayNightRaw === 'D' ? 'day' : dayNightRaw === 'N' ? 'night' : 'unknown',
            version: r.version ? String(r.version) : null,
          } satisfies FireDetection
        })
        .filter((d): d is FireDetection => d !== null)

      // Zero detections is a real, meaningful answer here — not an error.
      const byConfidence = { low: 0, nominal: 0, high: 0, unknown: 0 }
      for (const d of detections) byConfidence[d.confidenceClass]++

      const withFrp = detections.filter((d) => d.frpMegawatts !== null)
      const newest = detections
        .map((d) => d.acquiredAtUtc)
        .filter((t): t is string => Boolean(t))
        .sort()
        .pop() ?? null

      const resolvedSource = (String(body.source ?? source) as FirmsSource) in FIRMS_SOURCES
        ? (String(body.source ?? source) as FirmsSource)
        : source

      return {
        source: resolvedSource,
        sourceLabel: FIRMS_SOURCES[resolvedSource].label,
        resolutionMetres: FIRMS_SOURCES[resolvedSource].resolutionMetres,
        days: finiteOrNull(body.days) ?? days,
        bbox,
        detections: detections.sort((a, b) => (b.frpMegawatts ?? 0) - (a.frpMegawatts ?? 0)),
        byConfidence,
        totalFrpMegawatts:
          withFrp.length > 0 ? withFrp.reduce((sum, d) => sum + (d.frpMegawatts ?? 0), 0) : null,
        detectionsWithFrp: withFrp.length,
        newestAcquisitionUtc: newest,
        retrievedAt: String(body.retrievedAt ?? new Date().toISOString()),
      }
    },
  })

  return retag(result, {
    kind: 'satellite',
    observedAt: result.data.newestAcquisitionUtc ?? null,
    notes: [
      `${result.data.sourceLabel}, ${result.data.resolutionMetres} m nominal pixel.`,
      'Detections are thermal anomalies measured from orbit, not confirmed ground fires.',
      'No detections does not mean no fire: cloud, overpass timing and small or cool fires all go unseen.',
    ],
  })
}

/** Proxy-level failure specific to a missing map key. */
export function isMissingFirmsKey(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'auth' && error.sourceId === 'nasa-firms'
}
