/** Smart City: OpenStreetMap urban fabric for the selected location. */

import { fetchUrbanFabric, type UrbanFabric } from '../api/openStreetMap'
import { useAsyncData, type AsyncResult } from './useAsyncData'
import type { GeoPlace } from '../api/openMeteo'

export function useUrbanFabric(place: GeoPlace, radiusDegrees = 0.02): AsyncResult<UrbanFabric> {
  const cacheKey = `osm-urban:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}:${radiusDegrees}`
  return useAsyncData<UrbanFabric>(
    (signal, bypassCache) =>
      fetchUrbanFabric({
        latitude: place.latitude,
        longitude: place.longitude,
        radiusDegrees,
        signal,
        bypassCache,
      }),
    [place.latitude, place.longitude, radiusDegrees],
    { staleFallbackKey: cacheKey },
  )
}

/** Why there is no traffic layer. */
export const trafficReadiness = {
  integrated: false,
  note: 'Live traffic speed and volume come from commercial probe-data providers (TomTom, HERE, Google) under paid, attribution-restricted licences. None is integrated, so this module shows road geometry and classification from OpenStreetMap and makes no claim about current or predicted traffic.',
} as const
