/**
 * Air-quality hooks: find the nearest OpenAQ station, read its latest values,
 * and compute the US EPA index from whatever pollutants it actually reports.
 */

import { useMemo } from 'react'
import {
  fetchLatestForStation,
  findStations,
  readingAgeHours,
  type AirQualitySnapshot,
  type MonitorStation,
  type StationSearchResult,
} from '../api/openAq'
import { computeAqi, type AqiResult } from '../domain/aqi'
import { useAsyncData, type AsyncResult } from './useAsyncData'
import type { GeoPlace } from '../api/openMeteo'

/**
 * @param enabled Pass false once the proxy has reported no OpenAQ credential,
 *   so the app does not issue a request that is certain to come back 503.
 */
export function useNearbyStations(
  place: GeoPlace,
  radiusMetres = 25_000,
  enabled = true,
): AsyncResult<StationSearchResult> {
  const cacheKey = `openaq-stations:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}:${radiusMetres}:50`
  return useAsyncData<StationSearchResult>(
    (signal, bypassCache) =>
      findStations({
        latitude: place.latitude,
        longitude: place.longitude,
        radiusMetres,
        signal,
        bypassCache,
      }),
    [place.latitude, place.longitude, radiusMetres],
    { enabled, staleFallbackKey: cacheKey },
  )
}

export function useStationLatest(station: MonitorStation | null): AsyncResult<AirQualitySnapshot> {
  return useAsyncData<AirQualitySnapshot>(
    (signal, bypassCache) => fetchLatestForStation({ station: station!, signal, bypassCache }),
    [station?.locationId],
    {
      enabled: station !== null,
      staleFallbackKey: station ? `openaq-latest:${station.locationId}` : undefined,
      refreshIntervalMs: 15 * 60 * 1000,
    },
  )
}

export interface AirQualityAssessment {
  aqi: AqiResult | null
  /** Hours since the newest contributing measurement. */
  ageHours: number | null
  /** True when the newest reading is older than six hours. */
  stale: boolean
}

/**
 * The EPA index over a station's current readings.
 *
 * `reportedAveragingHours` is 1 because OpenAQ's latest endpoint returns the
 * most recent (typically hourly) value. The index requires 24-hour means for
 * particulates and 8-hour means for O₃ and CO, so the result records a period
 * mismatch for those and the UI shows it.
 */
export function useAirQualityIndex(snapshot: AirQualitySnapshot | null): AirQualityAssessment {
  return useMemo(() => {
    if (!snapshot || snapshot.readings.length === 0) {
      return { aqi: null, ageHours: null, stale: false }
    }
    const aqi = computeAqi(
      snapshot.readings.map((r) => ({ parameter: r.parameter, value: r.value, unit: r.unit })),
      1,
    )
    const ageHours = snapshot.newestMeasurementUtc ? readingAgeHours(snapshot.newestMeasurementUtc) : null
    return { aqi, ageHours, stale: ageHours !== null && ageHours > 6 }
  }, [snapshot])
}
