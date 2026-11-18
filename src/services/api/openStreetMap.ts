/**
 * OpenStreetMap features via the Overpass API, through our proxy.
 *
 * The proxy owns the Overpass QL (the browser only names a query kind and a
 * bounding box) for two reasons: Overpass asks callers to identify themselves
 * with a descriptive User-Agent, which a browser cannot set; and letting a page
 * post arbitrary Overpass QL through an identified agent invites abuse.
 *
 * OSM is volunteer-mapped. Completeness varies enormously between cities and
 * even between neighbourhoods, so every derived density figure here is
 * explicitly a density *of mapped features*, not of real-world features.
 */

import { ApiError, expectObject, finiteOrNull, requestJson, retag, type Envelope } from './client'

export interface LatLon {
  lat: number
  lon: number
}

export interface RoadFeature {
  id: number
  /** motorway | trunk | primary | secondary | tertiary */
  classification: string
  name: string | null
  lanes: number | null
  maxspeed: string | null
  surface: string | null
  /** Polyline in WGS84. */
  geometry: LatLon[]
  /** Great-circle length of the mapped polyline, metres. */
  lengthMetres: number
}

export interface BuildingFeature {
  id: number
  /** The raw `building` tag value: yes, residential, commercial, … */
  category: string
  name: string | null
  /** Mapped storey count, where tagged. Most buildings are untagged. */
  levels: number | null
  centre: LatLon
}

export interface GreenFeature {
  id: number
  /** park | garden | nature_reserve | forest | grass | meadow | … */
  category: string
  name: string | null
  geometry: LatLon[]
  /** Shoelace area of the mapped polygon, square metres. */
  areaSquareMetres: number
  centroid: LatLon
}

export interface UrbanFabric {
  bbox: { west: number; south: number; east: number; north: number }
  /** Ground area of the query box, km². */
  areaSquareKm: number
  roads: RoadFeature[]
  buildings: BuildingFeature[]
  greenSpaces: GreenFeature[]
  /** Metres of mapped major road per km² of query box. */
  roadDensityMetresPerSquareKm: number
  /** Mapped building footprints per km². */
  buildingDensityPerSquareKm: number
  /** Share of the box covered by mapped green polygons, %. */
  mappedGreenCoverPercent: number
  /** Total mapped green area, hectares. */
  greenAreaHectares: number
  /** Which result buckets hit the proxy's `out` cap — figures are then floors. */
  truncated: { roads: boolean; buildings: boolean; greenSpaces: boolean }
  attribution: string
  retrievedAt: string
}

/** Great-circle distance in metres. */
function distanceMetres(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6_371_000
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function polylineLength(points: LatLon[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distanceMetres(points[i - 1], points[i])
  return total
}

/**
 * Planar shoelace area after an equirectangular projection about the polygon's
 * own mean latitude. Accurate enough for city-block polygons; well short of a
 * geodesic computation, which these numbers do not warrant.
 */
function polygonArea(points: LatLon[]): number {
  if (points.length < 3) return 0
  const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const mPerDegLat = 111_132
  const mPerDegLon = 111_320 * Math.cos((meanLat * Math.PI) / 180)
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.lon * mPerDegLon * (b.lat * mPerDegLat) - b.lon * mPerDegLon * (a.lat * mPerDegLat)
  }
  return Math.abs(sum) / 2
}

function centroidOf(points: LatLon[]): LatLon {
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length
  const lon = points.reduce((s, p) => s + p.lon, 0) / points.length
  return { lat, lon }
}

function geometryOf(element: Record<string, unknown>): LatLon[] {
  const raw = element.geometry
  if (!Array.isArray(raw)) return []
  return raw
    .map((node) => {
      const n = node as Record<string, unknown>
      const lat = finiteOrNull(n.lat)
      const lon = finiteOrNull(n.lon)
      return lat !== null && lon !== null ? { lat, lon } : null
    })
    .filter((p): p is LatLon => p !== null)
}

const GREEN_LEISURE = new Set(['park', 'garden', 'nature_reserve'])
const GREEN_LANDUSE = new Set(['grass', 'forest', 'meadow', 'recreation_ground', 'village_green'])

export interface UrbanFabricRequest {
  latitude: number
  longitude: number
  /** Half-width of the query box in degrees. The proxy caps the span at 0.6°. */
  radiusDegrees?: number
  signal?: AbortSignal
  bypassCache?: boolean
}

export async function fetchUrbanFabric(request: UrbanFabricRequest): Promise<Envelope<UrbanFabric>> {
  const { latitude, longitude, radiusDegrees = 0.025, signal, bypassCache } = request

  const bbox = {
    west: longitude - radiusDegrees,
    south: latitude - radiusDegrees,
    east: longitude + radiusDegrees,
    north: latitude + radiusDegrees,
  }

  const params = new URLSearchParams({
    kind: 'urban',
    west: bbox.west.toFixed(5),
    south: bbox.south.toFixed(5),
    east: bbox.east.toFixed(5),
    north: bbox.north.toFixed(5),
  })

  const result = await requestJson<UrbanFabric>(`/api/overpass?${params}`, {
    cacheKey: `osm-urban:${latitude.toFixed(3)},${longitude.toFixed(3)}:${radiusDegrees}`,
    sourceId: 'openstreetmap',
    signal,
    bypassCache,
    // OSM changes slowly and Overpass is a shared volunteer resource.
    ttlMs: 6 * 60 * 60 * 1000,
    // Above the proxy's own Overpass ceiling, so the proxy's structured
    // rate-limit answer reaches us rather than our client timing out first.
    timeoutMs: 80_000,
    retries: 1,
    parse: (raw) => {
      const body = expectObject(raw, 'openstreetmap', 'Overpass proxy response')
      const osm = expectObject(body.osm, 'openstreetmap', 'osm payload')
      const elements = Array.isArray(osm.elements) ? osm.elements : []
      const caps = (body.truncated ?? {}) as Record<string, number>

      const roads: RoadFeature[] = []
      const buildings: BuildingFeature[] = []
      const greenSpaces: GreenFeature[] = []

      for (const item of elements) {
        const element = item as Record<string, unknown>
        const tags = (element.tags ?? {}) as Record<string, string>
        const id = finiteOrNull(element.id)
        if (id === null) continue

        if (tags.highway) {
          const geometry = geometryOf(element)
          if (geometry.length < 2) continue
          roads.push({
            id,
            classification: tags.highway,
            name: tags.name ?? null,
            lanes: finiteOrNull(tags.lanes),
            maxspeed: tags.maxspeed ?? null,
            surface: tags.surface ?? null,
            geometry,
            lengthMetres: polylineLength(geometry),
          })
          continue
        }

        if (tags.building) {
          // Requested with `out center`, so the centre arrives pre-computed.
          const centre = element.center as Record<string, unknown> | undefined
          const lat = finiteOrNull(centre?.lat ?? element.lat)
          const lon = finiteOrNull(centre?.lon ?? element.lon)
          if (lat === null || lon === null) continue
          buildings.push({
            id,
            category: tags.building,
            name: tags.name ?? null,
            levels: finiteOrNull(tags['building:levels']),
            centre: { lat, lon },
          })
          continue
        }

        const greenCategory =
          (tags.leisure && GREEN_LEISURE.has(tags.leisure) && tags.leisure) ||
          (tags.landuse && GREEN_LANDUSE.has(tags.landuse) && tags.landuse) ||
          null
        if (greenCategory) {
          const geometry = geometryOf(element)
          if (geometry.length < 3) continue
          greenSpaces.push({
            id,
            category: greenCategory,
            name: tags.name ?? null,
            geometry,
            areaSquareMetres: polygonArea(geometry),
            centroid: centroidOf(geometry),
          })
        }
      }

      if (roads.length === 0 && buildings.length === 0 && greenSpaces.length === 0) {
        throw new ApiError(
          'empty',
          'OpenStreetMap has no mapped roads, buildings or green spaces in this area. This is a gap in volunteer mapping coverage, not an absence of features on the ground.',
          { sourceId: 'openstreetmap' },
        )
      }

      // Ground area of the query box.
      const heightKm = (bbox.north - bbox.south) * 110.574
      const widthKm = (bbox.east - bbox.west) * 111.32 * Math.cos((latitude * Math.PI) / 180)
      const areaSquareKm = Math.max(heightKm * widthKm, 0.0001)

      const roadMetres = roads.reduce((sum, r) => sum + r.lengthMetres, 0)
      const greenArea = greenSpaces.reduce((sum, g) => sum + g.areaSquareMetres, 0)

      return {
        bbox,
        areaSquareKm,
        roads,
        buildings,
        greenSpaces,
        roadDensityMetresPerSquareKm: roadMetres / areaSquareKm,
        buildingDensityPerSquareKm: buildings.length / areaSquareKm,
        mappedGreenCoverPercent: Math.min((greenArea / (areaSquareKm * 1_000_000)) * 100, 100),
        greenAreaHectares: greenArea / 10_000,
        truncated: {
          roads: roads.length >= (caps.roads ?? Infinity),
          buildings: buildings.length >= (caps.buildings ?? Infinity),
          greenSpaces: greenSpaces.length >= (caps.green ?? Infinity),
        },
        attribution: String(body.attribution ?? '© OpenStreetMap contributors (ODbL)'),
        retrievedAt: String(body.retrievedAt ?? new Date().toISOString()),
      }
    },
  })

  const { truncated } = result.data
  return retag(result, {
    kind: 'observation',
    // OSM elements carry per-edit timestamps, not a snapshot time for the query.
    observedAt: null,
    notes: [
      'Densities describe features mapped in OpenStreetMap, which under-counts wherever volunteer mapping is incomplete.',
      ...(truncated.roads || truncated.buildings || truncated.greenSpaces
        ? [
            `Result capped for ${[
              truncated.roads && 'roads',
              truncated.buildings && 'buildings',
              truncated.greenSpaces && 'green spaces',
            ]
              .filter(Boolean)
              .join(', ')}; the derived figures are lower bounds.`,
          ]
        : []),
    ],
  })
}

/** Project a lat/lon into metres relative to a centre — for the 3D scene. */
export function projectToMetres(point: LatLon, centre: LatLon): { x: number; z: number } {
  const mPerDegLat = 111_132
  const mPerDegLon = 111_320 * Math.cos((centre.lat * Math.PI) / 180)
  return {
    x: (point.lon - centre.lon) * mPerDegLon,
    // Screen-space z grows southward.
    z: -(point.lat - centre.lat) * mPerDegLat,
  }
}
