/**
 * Builds each engine's baseline from the real Phase 1 data hooks.
 *
 * Every field is null when its provider returned nothing; nothing is defaulted.
 * Results are memoised on the underlying envelopes, because useSimulation
 * re-initialises the run whenever the baseline identity changes.
 */

import { useMemo } from 'react'
import { useSelectedLocation } from '../../context/LocationContext'
import { useHistoricalClimate, usePowerDaily, useWeather } from '../../services/hooks/useClimateData'
import { useBiodiversity, useFireDetections } from '../../services/hooks/useForestData'
import { useRiverDischarge, useUsgsStations } from '../../services/hooks/useWaterData'
import { useUrbanFabric } from '../../services/hooks/useUrbanData'
import { useProxyHealth } from '../../services/hooks/useProxyHealth'
import { buildClimateBaseline, type ClimateBaseline } from '../engines/climate'
import type { DataCentreBaseline } from '../engines/datacentre'
import type { ForestBaseline } from '../engines/forest'
import type { WaterBaseline } from '../engines/water'
import type { AgricultureBaseline } from '../engines/agriculture'
import type { CityBaseline } from '../engines/city'
import { PARAMETER_CODES } from '../../services/api/usgs'

const num = (v: number | null | undefined): number[] => (v === null || v === undefined ? [] : [v])

export function useClimateBaseline(): ClimateBaseline {
  const { location, label } = useSelectedLocation()
  const weather = useWeather(location, { forecastDays: 7 })
  const historical = useHistoricalClimate(location, 5)
  const power = usePowerDaily(location, 90)
  const current = weather.envelope?.data.current ?? null
  const monthly = historical.envelope?.data.monthly
  const irradiance = power.envelope?.data.meanIrradianceKwh ?? null
  return useMemo(
    () =>
      buildClimateBaseline({
        monthly: monthly ?? [],
        currentTemperatureC: current?.temperature ?? null,
        currentCloudCoverPercent: current?.cloudCover ?? null,
        meanIrradianceKwhPerM2Day: irradiance,
        locationLabel: label,
      }),
    [monthly, current?.temperature, current?.cloudCover, irradiance, label],
  )
}

export function useDataCentreBaseline(): DataCentreBaseline {
  const { location, label } = useSelectedLocation()
  const weather = useWeather(location, { forecastDays: 1 })
  const t = weather.envelope?.data.current?.temperature ?? null
  return useMemo(
    () => ({
      outdoorTemperatureC: t,
      locationLabel: label,
      provenance:
        t === null
          ? ['No outdoor temperature observed; free-cooling benefit is not applied.']
          : [`Outdoor air ${t} °C observed at ${label} (Open-Meteo); drives the free-cooling term.`],
      seededFromObservation: t !== null,
    }),
    [t, label],
  )
}

export function useWaterBaseline(): WaterBaseline {
  const { location, label } = useSelectedLocation()
  const weather = useWeather(location, { forecastDays: 7, pastDays: 7 })
  const flood = useRiverDischarge(location)
  const usgs = useUsgsStations(location)
  const daily = weather.envelope?.data.daily
  const current = weather.envelope?.data.current
  const days = flood.envelope?.data.days
  const stations = usgs.envelope?.data.stations
  return useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const rain = (daily ?? []).map((d) => d.precipitationSum ?? 0)
    const forecastStartIndex = Math.max((daily ?? []).findIndex((d) => d.date >= today), 0)
    const glofas = days?.find((d) => d.date === today)?.discharge ?? null
    let gauge: number | null = null
    let gaugeName: string | null = null
    for (const s of stations ?? []) {
      const q = s.series.find((x) => x.parameterCode === PARAMETER_CODES.discharge)?.latestSi
      if (q) { gauge = q.value; gaugeName = s.siteName; break }
    }
    const seeded = rain.length > 0 || glofas !== null || gauge !== null
    return {
      dailyRainfallMm: rain,
      forecastStartIndex,
      meanTemperatureC: current?.temperature ?? null,
      glofasDischargeCumecs: glofas,
      gaugeDischargeCumecs: gauge,
      gaugeName,
      locationLabel: label,
      provenance: [
        rain.length ? `${rain.length} days of Open-Meteo precipitation (${forecastStartIndex} observed, rest forecast).` : 'No precipitation series loaded; rainfall is zero.',
        glofas !== null ? `GloFAS discharge today ${glofas.toFixed(2)} m³/s (model, not a gauge).` : 'No GloFAS river cell here.',
        gauge !== null ? `USGS gauge ${gaugeName}: ${gauge.toFixed(2)} m³/s observed.` : 'No USGS gauge reading (US-only network).',
      ],
      seededFromObservation: seeded,
    }
  }, [daily, current?.temperature, days, stations, label])
}

export function useAgricultureBaseline(): AgricultureBaseline {
  const { location, label } = useSelectedLocation()
  const weather = useWeather(location, { forecastDays: 7, pastDays: 7, includeSoilMoisture: true })
  const power = usePowerDaily(location, 60)
  const daily = weather.envelope?.data.daily
  const hourly = weather.envelope?.data.hourly
  const irradiance = power.envelope?.data.meanIrradianceKwh ?? null
  return useMemo(() => {
    const d = daily ?? []
    const soil = [...(hourly ?? [])].reverse().find((h) => h.soilMoisture0to7cm !== null)?.soilMoisture0to7cm ?? null
    return {
      dailyEt0Mm: d.flatMap((x) => num(x.et0)),
      dailyRainfallMm: d.map((x) => x.precipitationSum ?? 0),
      dailyMeanTemperatureC: d.flatMap((x) => num(x.temperatureMean)),
      observedSoilMoisture: soil,
      meanIrradianceKwhPerM2Day: irradiance,
      locationLabel: label,
      provenance: [
        d.length ? `${d.length} days of Open-Meteo ET₀, rainfall and temperature for ${label}.` : 'No weather series loaded.',
        soil !== null ? `Soil moisture ${soil.toFixed(3)} m³/m³ (0–7 cm layer) seeds the starting depletion.` : 'No soil-moisture data for this location; the run starts at field capacity.',
      ],
      seededFromObservation: d.length > 0,
    }
  }, [daily, hourly, irradiance, label])
}

export function useForestBaseline(): ForestBaseline {
  const { location, label } = useSelectedLocation()
  const health = useProxyHealth()
  const weather = useWeather(location, { forecastDays: 1, pastDays: 7 })
  const fires = useFireDetections(location, { enabled: health.envelope?.data.integrations.firms.configured === true })
  const bio = useBiodiversity(location)
  const current = weather.envelope?.data.current
  const daily = weather.envelope?.data.daily
  const detections = fires.envelope?.data.detections.length ?? null
  const species = bio.envelope?.data.distinctSpeciesInPage ?? null
  return useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const past = (daily ?? []).filter((x) => x.date < today && x.precipitationSum !== null)
    return {
      observedTemperatureC: current?.temperature ?? null,
      observedHumidityPercent: current?.relativeHumidity ?? null,
      observedWindSpeedKmh: current?.windSpeed ?? null,
      observedWindDirectionDeg: current?.windDirection ?? null,
      recentRainfallMm: past.length ? past.reduce((s, x) => s + (x.precipitationSum ?? 0), 0) : null,
      satelliteDetectionCount: detections,
      recordedSpeciesCount: species,
      locationLabel: label,
      provenance: [
        current ? `Fire weather observed at ${label} (Open-Meteo).` : 'No fire-weather observation loaded.',
        detections === null ? 'NASA FIRMS unavailable (no key or no response); detections not shown.' : `${detections} FIRMS detections — real, kept separate from the simulation.`,
      ],
      seededFromObservation: current !== undefined && current !== null,
    }
  }, [current, daily, detections, species, label])
}

export function useCityBaseline(): CityBaseline {
  const { location, label } = useSelectedLocation()
  const weather = useWeather(location, { forecastDays: 1 })
  const fabric = useUrbanFabric(location)
  const t = weather.envelope?.data.current?.temperature ?? null
  const f = fabric.envelope?.data
  return useMemo(
    () => ({
      mappedBuildingCount: f ? f.buildings.length : null,
      mappedGreenCoverPercent: f ? f.mappedGreenCoverPercent : null,
      mappedRoadKm: f ? f.roads.reduce((s, r) => s + r.lengthMetres, 0) / 1000 : null,
      queryAreaKm2: f ? f.areaSquareKm : null,
      observedTemperatureC: t,
      observedAqi: null,
      locationLabel: label,
      provenance: [
        f ? `${f.buildings.length} buildings, ${f.mappedGreenCoverPercent.toFixed(1)}% mapped green cover (OpenStreetMap, volunteer-mapped).` : 'No OpenStreetMap data loaded.',
        t !== null ? `Temperature ${t} °C observed.` : 'No temperature observation.',
        'Air-quality index is shown in the data panels, not fed to this model.',
      ],
      seededFromObservation: f !== undefined || t !== null,
    }),
    [f, t, label],
  )
}
