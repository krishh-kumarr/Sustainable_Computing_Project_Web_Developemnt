/**
 * Climate / weather data hooks.
 *
 * Naming discipline, because the distinction matters scientifically: the
 * Open-Meteo forecast endpoint gives a short-range WEATHER forecast of hours to
 * about sixteen days. It is not a climate projection. Anything spanning decades
 * requires a CMIP6 downscaled product (see cmip6Readiness below) and is not
 * integrated, so long-horizon controls in the UI are labelled illustrative.
 */

import {
  fetchForecast,
  fetchHistorical,
  toMonthly,
  type ForecastBundle,
  type MonthlyClimateRow,
} from '../api/openMeteo'
import { fetchPowerDaily, powerSafeDateRange, type PowerBundle } from '../api/nasaPower'
import { useAsyncData, type AsyncResult } from './useAsyncData'
import type { GeoPlace } from '../api/openMeteo'

/** Current conditions plus a 7-day weather forecast. */
export function useWeather(
  place: GeoPlace,
  options: { forecastDays?: number; includeSoilMoisture?: boolean; pastDays?: number } = {},
): AsyncResult<ForecastBundle> {
  const { forecastDays = 7, includeSoilMoisture = false, pastDays = 0 } = options
  const cacheKey = `om-forecast:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}:${forecastDays}:${pastDays}:true:${includeSoilMoisture}`

  return useAsyncData<ForecastBundle>(
    (signal, bypassCache) =>
      fetchForecast({
        latitude: place.latitude,
        longitude: place.longitude,
        forecastDays,
        pastDays,
        includeSoilMoisture,
        signal,
        bypassCache,
      }),
    [place.latitude, place.longitude, forecastDays, pastDays, includeSoilMoisture],
    {
      staleFallbackKey: cacheKey,
      // Open-Meteo updates current conditions every 15 minutes upstream.
      refreshIntervalMs: 15 * 60 * 1000,
    },
  )
}

export interface HistoricalClimate {
  monthly: MonthlyClimateRow[]
  bundle: ForecastBundle
  /** Whole years actually covered by the request. */
  yearsCovered: number
}

/**
 * ERA5 reanalysis over the last N whole years, aggregated to monthly means.
 * Ends five days before today, because the archive lags real time.
 */
export function useHistoricalClimate(place: GeoPlace, years = 5): AsyncResult<HistoricalClimate> {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - 6)
  const start = new Date(end)
  start.setUTCFullYear(start.getUTCFullYear() - years)

  const startDate = start.toISOString().slice(0, 10)
  const endDate = end.toISOString().slice(0, 10)
  const cacheKey = `om-archive:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}:${startDate}:${endDate}`

  return useAsyncData<HistoricalClimate>(
    async (signal, bypassCache) => {
      const result = await fetchHistorical({
        latitude: place.latitude,
        longitude: place.longitude,
        startDate,
        endDate,
        signal,
        bypassCache,
      })
      return {
        ...result,
        data: { monthly: toMonthly(result.data.daily), bundle: result.data, yearsCovered: years },
      }
    },
    [place.latitude, place.longitude, startDate, endDate],
    { staleFallbackKey: cacheKey },
  )
}

/** NASA POWER solar and meteorological daily record over a recent window. */
export function usePowerDaily(place: GeoPlace, daysBack = 90): AsyncResult<PowerBundle> {
  const { start, end } = powerSafeDateRange(daysBack)
  const parameters = ['ALLSKY_SFC_SW_DWN', 'CLRSKY_SFC_SW_DWN', 'T2M', 'PRECTOTCORR', 'RH2M'] as const
  const cacheKey = `power:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}:${start}:${end}:${parameters.join('|')}:AG`

  return useAsyncData<PowerBundle>(
    (signal, bypassCache) =>
      fetchPowerDaily({
        latitude: place.latitude,
        longitude: place.longitude,
        start,
        end,
        parameters: [...parameters],
        community: 'AG',
        signal,
        bypassCache,
      }),
    [place.latitude, place.longitude, start, end],
    { staleFallbackKey: cacheKey },
  )
}

/**
 * Where long-term climate projection would plug in, and why it hasn't.
 *
 * This is documentation, not a stub that returns numbers. Until a CMIP6
 * downscaled product is actually wired up, the UI's long-horizon controls are
 * labelled ILLUSTRATIVE SCENARIO and make no predictive claim.
 */
export const cmip6Readiness = {
  integrated: false,
  candidateDataset: 'NASA NEX-GDDP-CMIP6',
  datasetUrl: 'https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6',
  resolution: '0.25° (~25 km), daily, 1950–2100',
  scenarios: ['historical', 'ssp245', 'ssp585'],
  blockers: [
    'NEX-GDDP-CMIP6 is distributed as NetCDF on S3 and THREDDS, not as a point-query JSON API, so it needs a server-side extraction step this project does not yet have.',
    'A credible projection is a multi-model ensemble with a stated spread, not a single model run. Presenting one model as "the" projection would misrepresent the science.',
    'Projections are anomalies against a baseline period, which has to be stated alongside every figure.',
  ],
  whatTheUiDoesInstead:
    'Long-horizon temperature and precipitation controls apply a user-chosen offset to the observed record and are labelled ILLUSTRATIVE SCENARIO. They show sensitivity, not prediction.',
} as const
