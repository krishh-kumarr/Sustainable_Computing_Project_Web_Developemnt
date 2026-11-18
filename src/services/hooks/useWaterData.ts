/**
 * AquaGuard data: GloFAS river-discharge forecasts, USGS gauge observations,
 * and the precipitation record that drives the water scene.
 */

import { fetchRiverDischarge, type FloodBundle } from '../api/openMeteo'
import { fetchWaterStations, withinUsgsCoverage, type UsgsBundle } from '../api/usgs'
import { useAsyncData, type AsyncResult } from './useAsyncData'
import type { GeoPlace } from '../api/openMeteo'

export function useRiverDischarge(
  place: GeoPlace,
  options: { forecastDays?: number; pastDays?: number } = {},
): AsyncResult<FloodBundle> {
  const { forecastDays = 14, pastDays = 30 } = options
  const cacheKey = `om-flood:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}:${forecastDays}:${pastDays}`

  return useAsyncData<FloodBundle>(
    (signal, bypassCache) =>
      fetchRiverDischarge({
        latitude: place.latitude,
        longitude: place.longitude,
        forecastDays,
        pastDays,
        signal,
        bypassCache,
      }),
    [place.latitude, place.longitude, forecastDays, pastDays],
    { staleFallbackKey: cacheKey },
  )
}

/**
 * USGS gauges. Disabled outside US coverage rather than issuing a request that
 * is certain to come back empty.
 */
export function useUsgsStations(place: GeoPlace, radiusDegrees = 0.6): AsyncResult<UsgsBundle> & {
  inCoverage: boolean
} {
  const inCoverage = withinUsgsCoverage(place.latitude, place.longitude)
  const cacheKey = `usgs:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}:${radiusDegrees}:P7D`

  const result = useAsyncData<UsgsBundle>(
    (signal, bypassCache) =>
      fetchWaterStations({
        latitude: place.latitude,
        longitude: place.longitude,
        radiusDegrees,
        period: 'P7D',
        signal,
        bypassCache,
      }),
    [place.latitude, place.longitude, radiusDegrees],
    { enabled: inCoverage, staleFallbackKey: cacheKey, refreshIntervalMs: 15 * 60 * 1000 },
  )

  return { ...result, inCoverage }
}

/**
 * Indian water data — investigated, and not integrated. Recorded here so the
 * UI can state exactly why rather than leaving a silent gap.
 */
export const indiaWaterReadiness = {
  integrated: false,
  sourcesInvestigated: [
    {
      name: 'India-WRIS (Water Resources Information System)',
      url: 'https://indiawris.gov.in/',
      finding:
        'Publishes reservoir levels and river-gauge data through an interactive portal. The underlying endpoints are not a documented public API, carry no CORS headers, and the terms do not grant programmatic redistribution. Scraping them would be both unreliable and outside the licence.',
    },
    {
      name: 'Central Water Commission flood forecasts',
      url: 'https://ffs.india-water.gov.in/',
      finding:
        'Issues station-level flood forecasts as HTML and PDF bulletins. No machine-readable feed is published.',
    },
    {
      name: 'data.gov.in water resources catalogue',
      url: 'https://data.gov.in/sector/water-resources',
      finding:
        'Holds historical CSV datasets rather than current observations, with inconsistent station identifiers between releases. Useful for a static study, not for a live panel.',
    },
  ],
  consequence:
    'For Indian locations this module shows GloFAS discharge forecasts and Open-Meteo precipitation, which do have genuine coverage, and reports gauge observations as unavailable. No Indian river sensor reading is fabricated to fill the gap.',
} as const
