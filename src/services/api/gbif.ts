/**
 * GBIF occurrence records — biodiversity observations near a location.
 *
 * The honesty constraint that governs this whole file: an occurrence record is
 * evidence that somebody observed and digitised a specimen at a place and time.
 * Record density therefore measures survey effort as much as it measures
 * biodiversity, and the absence of records is not evidence of the absence of
 * species. Every consumer of this data must surface that.
 */

import { expectArray, expectObject, finiteOrNull, requestJson, retag, type Envelope } from './client'

const GBIF_BASE = 'https://api.gbif.org/v1'

export interface Occurrence {
  key: number
  scientificName: string | null
  /** Vernacular name, when the publishing dataset supplies one. */
  vernacularName: string | null
  kingdom: string | null
  phylum: string | null
  class: string | null
  order: string | null
  family: string | null
  genus: string | null
  /** 'SPECIES', 'GENUS', … — how precisely the record was identified. */
  taxonRank: string | null
  latitude: number
  longitude: number
  /** Reported coordinate uncertainty in metres, when recorded. */
  coordinateUncertaintyMetres: number | null
  eventDate: string | null
  year: number | null
  basisOfRecord: string | null
  datasetName: string | null
  datasetKey: string | null
  publishingCountry: string | null
  /** Non-fatal data-quality flags GBIF attached to the record. */
  issues: string[]
  iucnRedListCategory: string | null
}

export interface OccurrenceBundle {
  /** Total matching records GBIF holds — usually far more than we fetched. */
  totalMatching: number
  /** The records actually returned by this page. */
  records: Occurrence[]
  /** Distinct scientific names within the returned page. */
  distinctSpeciesInPage: number
  /** Year range covered by the returned page. */
  yearRange: { from: number; to: number } | null
  /** Distinct publishing datasets within the returned page. */
  datasets: { key: string; name: string; recordCount: number }[]
  /** The spatial window queried. */
  bbox: { west: number; south: number; east: number; north: number }
  endOfRecords: boolean
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

export interface OccurrenceRequest {
  latitude: number
  longitude: number
  /** Half-width of the search box in degrees. */
  radiusDegrees?: number
  limit?: number
  /** Only records from this year onward, to keep the picture current. */
  sinceYear?: number
  /** Restrict to a kingdom key, e.g. 6 = Plantae, 1 = Animalia. */
  kingdomKey?: number
  signal?: AbortSignal
  bypassCache?: boolean
}

export async function fetchOccurrences(request: OccurrenceRequest): Promise<Envelope<OccurrenceBundle>> {
  const {
    latitude,
    longitude,
    radiusDegrees = 0.25,
    limit = 300,
    sinceYear,
    kingdomKey,
    signal,
    bypassCache,
  } = request

  const west = longitude - radiusDegrees
  const east = longitude + radiusDegrees
  const south = latitude - radiusDegrees
  const north = latitude + radiusDegrees

  const params = new URLSearchParams({
    decimalLatitude: `${south.toFixed(4)},${north.toFixed(4)}`,
    decimalLongitude: `${west.toFixed(4)},${east.toFixed(4)}`,
    hasCoordinate: 'true',
    hasGeospatialIssue: 'false',
    limit: String(Math.min(limit, 300)),
  })
  if (sinceYear) params.set('year', `${sinceYear},${new Date().getUTCFullYear()}`)
  if (kingdomKey) params.set('kingdomKey', String(kingdomKey))

  const url = `${GBIF_BASE}/occurrence/search?${params}`

  const result = await requestJson<OccurrenceBundle>(url, {
    cacheKey: `gbif:${latitude.toFixed(3)},${longitude.toFixed(3)}:${radiusDegrees}:${limit}:${sinceYear ?? ''}:${kingdomKey ?? ''}`,
    sourceId: 'gbif',
    signal,
    bypassCache,
    ttlMs: 60 * 60 * 1000,
    timeoutMs: 35_000,
    parse: (raw) => {
      const body = expectObject(raw, 'gbif', 'occurrence search response')
      const results = expectArray(body.results ?? [], 'gbif', 'occurrence results')

      const records: Occurrence[] = results
        .map((item) => {
          const r = item as Record<string, unknown>
          const lat = finiteOrNull(r.decimalLatitude)
          const lon = finiteOrNull(r.decimalLongitude)
          if (lat === null || lon === null) return null
          return {
            key: Number(r.key),
            scientificName: str(r.scientificName ?? r.species),
            vernacularName: str(r.vernacularName),
            kingdom: str(r.kingdom),
            phylum: str(r.phylum),
            class: str(r.class),
            order: str(r.order),
            family: str(r.family),
            genus: str(r.genus),
            taxonRank: str(r.taxonRank),
            latitude: lat,
            longitude: lon,
            coordinateUncertaintyMetres: finiteOrNull(r.coordinateUncertaintyInMeters),
            eventDate: str(r.eventDate),
            year: finiteOrNull(r.year),
            basisOfRecord: str(r.basisOfRecord),
            datasetName: str(r.datasetName),
            datasetKey: str(r.datasetKey),
            publishingCountry: str(r.publishingCountry),
            issues: Array.isArray(r.issues) ? r.issues.map(String) : [],
            iucnRedListCategory: str(r.iucnRedListCategory),
          } satisfies Occurrence
        })
        .filter((r): r is Occurrence => r !== null)

      const names = new Set(records.map((r) => r.scientificName).filter((n): n is string => n !== null))
      const years = records.map((r) => r.year).filter((y): y is number => y !== null)

      const datasetMap = new Map<string, { key: string; name: string; recordCount: number }>()
      for (const record of records) {
        if (!record.datasetKey) continue
        const existing = datasetMap.get(record.datasetKey)
        if (existing) existing.recordCount++
        else
          datasetMap.set(record.datasetKey, {
            key: record.datasetKey,
            name: record.datasetName ?? 'Unnamed dataset',
            recordCount: 1,
          })
      }

      return {
        totalMatching: finiteOrNull(body.count) ?? records.length,
        records,
        distinctSpeciesInPage: names.size,
        yearRange: years.length > 0 ? { from: Math.min(...years), to: Math.max(...years) } : null,
        datasets: [...datasetMap.values()].sort((a, b) => b.recordCount - a.recordCount),
        bbox: { west, south, east, north },
        endOfRecords: Boolean(body.endOfRecords),
      }
    },
  })

  return retag(result, {
    kind: 'observation',
    // GBIF has no single response-level observation time; individual records
    // carry eventDate, and the page spans many of them.
    observedAt: null,
    period:
      result.data.yearRange !== null
        ? { start: String(result.data.yearRange.from), end: String(result.data.yearRange.to) }
        : undefined,
    notes: [
      'Occurrence records reflect where people have surveyed and published. They are a sample of observation effort, not a biodiversity census.',
      `${result.data.records.length} of ${result.data.totalMatching.toLocaleString()} matching records retrieved for this area.`,
    ],
  })
}

/** Rank the page's species by record count — a survey-effort tally, not abundance. */
export function speciesTally(
  records: Occurrence[],
  topN = 10,
): { name: string; vernacular: string | null; count: number; class: string | null }[] {
  const tally = new Map<string, { vernacular: string | null; count: number; class: string | null }>()
  for (const record of records) {
    if (!record.scientificName) continue
    const existing = tally.get(record.scientificName)
    if (existing) {
      existing.count++
      existing.vernacular = existing.vernacular ?? record.vernacularName
    } else {
      tally.set(record.scientificName, {
        vernacular: record.vernacularName,
        count: 1,
        class: record.class,
      })
    }
  }
  return [...tally.entries()]
    .map(([name, info]) => ({ name, ...info }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN)
}

/** Record counts by taxonomic class — again, effort-weighted, not abundance. */
export function classBreakdown(records: Occurrence[], topN = 6): { label: string; count: number }[] {
  const tally = new Map<string, number>()
  for (const record of records) {
    const key = record.class ?? record.kingdom ?? 'Unclassified'
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  return [...tally.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN)
}
