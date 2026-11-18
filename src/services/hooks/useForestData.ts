/**
 * Forest Intelligence data: satellite fire detections and biodiversity records.
 *
 * Deliberately absent: deforestation rate. No free point-query API supplies it,
 * and the module reports that as an unavailable integration rather than
 * inventing a percentage. See `deforestationReadiness`.
 */

import { fetchFireDetections, type FireBundle, type FirmsSource } from '../api/nasaFirms'
import { fetchOccurrences, type OccurrenceBundle } from '../api/gbif'
import { useAsyncData, type AsyncResult } from './useAsyncData'
import type { GeoPlace } from '../api/openMeteo'

export function useFireDetections(
  place: GeoPlace,
  options: {
    days?: number
    radiusDegrees?: number
    source?: FirmsSource
    /**
     * Pass false until the proxy has confirmed a map key exists, so the app
     * does not issue a request that is certain to come back 503.
     */
    enabled?: boolean
  } = {},
): AsyncResult<FireBundle> {
  const { days = 3, radiusDegrees = 1.5, source = 'VIIRS_SNPP_NRT', enabled = true } = options
  const cacheKey = `firms:${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}:${radiusDegrees}:${days}:${source}`

  return useAsyncData<FireBundle>(
    (signal, bypassCache) =>
      fetchFireDetections({
        latitude: place.latitude,
        longitude: place.longitude,
        radiusDegrees,
        days,
        source,
        signal,
        bypassCache,
      }),
    [place.latitude, place.longitude, days, radiusDegrees, source],
    { enabled, staleFallbackKey: cacheKey },
  )
}

export function useBiodiversity(
  place: GeoPlace,
  options: { radiusDegrees?: number; sinceYear?: number } = {},
): AsyncResult<OccurrenceBundle> {
  const { radiusDegrees = 0.25, sinceYear } = options
  const cacheKey = `gbif:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}:${radiusDegrees}:300:${sinceYear ?? ''}:`

  return useAsyncData<OccurrenceBundle>(
    (signal, bypassCache) =>
      fetchOccurrences({
        latitude: place.latitude,
        longitude: place.longitude,
        radiusDegrees,
        limit: 300,
        sinceYear,
        signal,
        bypassCache,
      }),
    [place.latitude, place.longitude, radiusDegrees, sinceYear],
    { staleFallbackKey: cacheKey },
  )
}

/** Why forest-cover change is shown as unavailable rather than estimated. */
export const deforestationReadiness = {
  integrated: false,
  candidateDatasets: [
    {
      name: 'Hansen Global Forest Change',
      url: 'https://glad.earthengine.app/view/global-forest-change',
      note: 'Annual 30 m tree-cover loss, 2000 onward. Distributed as GeoTIFF tiles or via Google Earth Engine, not a point-query API.',
    },
    {
      name: 'Global Forest Watch API',
      url: 'https://data-api.globalforestwatch.org/',
      note: 'Offers aggregate loss statistics, but requires an API key and queries are scoped to predefined administrative or custom geometries rather than arbitrary points.',
    },
  ],
  blockers: [
    'Both candidates need either raster tile processing or a registered key plus geometry upload — a server-side pipeline this phase does not include.',
    'Tree-cover loss is not the same thing as deforestation: it includes plantation harvest, fire and windthrow. Publishing it under a "deforestation" label would be wrong regardless of the integration.',
  ],
} as const

/** Why wildfire risk is shown as a scenario rather than a probability. */
export const wildfireRiskReadiness = {
  integrated: false,
  note: 'A wildfire probability requires a calibrated fire-danger model (fuel state, ignition likelihood, validated against historical ignitions). None is implemented here, so the module shows fire-weather inputs — observed temperature, humidity, wind and recent rainfall — and leaves the inference to the reader.',
} as const
