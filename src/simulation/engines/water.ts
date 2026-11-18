/**
 * Reservoir water-balance engine.
 *
 * A lumped storage accounting identity, stepped daily:
 *
 *   ΔS = (rainfall runoff + baseflow) − (release + demand + evaporation + seepage)
 *
 * with storage clipped to [0, capacity]: the excess becomes spill and the
 * shortfall becomes unmet demand, rather than letting the bucket hold negative
 * water.
 *
 * What it is not: a hydraulic model. It has no channel geometry, no routing,
 * no momentum and no floodplain. It can tell you how much water there is; it
 * cannot tell you where it goes, how fast it arrives, or which streets flood.
 * The "flood" indicator here is a reservoir-level threshold exceedance, which
 * is a different and much weaker statement than a flood forecast.
 *
 * Real observations — Open-Meteo precipitation, GloFAS discharge, USGS gauge
 * readings — seed the baseline where they exist, and are reported separately
 * from the model's own output.
 */

import type {
  EngineBaseline,
  MetricDefinition,
  ScenarioPreset,
  SeriesKey,
  SeriesRow,
  SimulationEngine,
} from '../types/engine.ts'
import type { ParameterSpec } from '../types/parameters.ts'
import {
  evaporationRateMmPerDay,
  levelFromStorage,
  stepReservoir,
  surfaceAreaFromStorage,
  type ReservoirGeometry,
} from '../models/waterBalance.ts'

export interface WaterBaseline extends EngineBaseline {
  /** Daily precipitation for the simulated span, mm. Observed then forecast. */
  dailyRainfallMm: number[]
  /** Index in dailyRainfallMm at which forecast replaces observation. */
  forecastStartIndex: number
  /** Observed mean air temperature, °C. */
  meanTemperatureC: number | null
  /** GloFAS modelled discharge for today, m³/s. Null off a modelled river. */
  glofasDischargeCumecs: number | null
  /** Observed USGS discharge at the nearest gauge, m³/s. */
  gaugeDischargeCumecs: number | null
  gaugeName: string | null
  locationLabel: string
}

export const EMPTY_WATER_BASELINE: WaterBaseline = {
  dailyRainfallMm: [],
  forecastStartIndex: 0,
  meanTemperatureC: null,
  glofasDischargeCumecs: null,
  gaugeDischargeCumecs: null,
  gaugeName: null,
  locationLabel: 'No location',
  provenance: ['No observed hydrology loaded yet.'],
  seededFromObservation: false,
}

export interface WaterState {
  day: number
  storageMcm: number
  /** Cumulative totals over the run, Mm³. */
  cumulative: {
    rainfallInflow: number
    baseInflow: number
    release: number
    demandSupplied: number
    evaporation: number
    seepage: number
    spill: number
    unmetDemand: number
  }
  spillDays: number
  deficitDays: number
  daysAboveFloodThreshold: number
  minStorageMcm: number
  maxStorageMcm: number
}

/** Fixed reservoir geometry so the 3D scene and the model agree. */
export function geometryFor(capacityMcm: number): ReservoirGeometry {
  return {
    capacityMcm,
    // Scales with capacity assuming roughly self-similar valley geometry.
    surfaceAreaAtFullKm2: 0.9 * Math.pow(capacityMcm / 100, 0.7),
    depthAtFullM: 28 * Math.pow(capacityMcm / 100, 0.2),
    // 2.0 is a valley reservoir; 1.0 would be a vertical-walled tank.
    stageStorageExponent: 2,
  }
}

const PARAMETERS: ParameterSpec[] = [
  {
    key: 'precipitationScalePercent',
    label: 'Rainfall scaling',
    unit: '%',
    min: 0,
    max: 400,
    step: 5,
    default: 100,
    decimals: 0,
    group: 'Inflow',
    sharedKey: 'precipitationScalePercent',
    note: 'Multiplier on the observed and forecast rainfall series for this location. Shared with Climate and AgriFuture, so a drought scenario set in Climate reaches the reservoir here.',
  },
  {
    key: 'catchmentAreaKm2',
    label: 'Catchment area',
    unit: 'km²',
    min: 10,
    max: 5000,
    step: 10,
    default: 450,
    decimals: 0,
    group: 'Inflow',
    note: 'Land area draining to the reservoir. Together with the runoff coefficient this converts rainfall depth into inflow volume.',
  },
  {
    key: 'runoffCoefficient',
    label: 'Runoff coefficient',
    unit: '',
    min: 0.05,
    max: 0.9,
    step: 0.01,
    default: 0.35,
    decimals: 2,
    group: 'Inflow',
    note: 'Fraction of rainfall reaching the channel rather than infiltrating or evaporating. A lumped empirical constant covering soil, slope, land cover and antecedent wetness — the crudest assumption in this model.',
  },
  {
    key: 'baseInflowCumecs',
    label: 'Baseflow inflow',
    unit: 'm³/s',
    min: 0,
    max: 500,
    step: 0.5,
    default: 8,
    decimals: 1,
    group: 'Inflow',
    seededFromObservation: true,
    note: 'Flow entering independently of this period\'s rainfall. Seeded from the GloFAS or USGS discharge for this location when one is available.',
  },
  {
    key: 'capacityMcm',
    label: 'Reservoir capacity',
    unit: 'Mm³',
    min: 10,
    max: 2000,
    step: 10,
    default: 250,
    decimals: 0,
    group: 'Reservoir',
    note: 'Usable storage at full supply level. Also sets surface area and depth through the stage-storage relation.',
  },
  {
    key: 'initialFillPercent',
    label: 'Starting fill',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    default: 62,
    decimals: 0,
    group: 'Reservoir',
    note: 'Storage at the start of the run, as a share of capacity. Antecedent storage dominates flood response far more than most people expect.',
  },
  {
    key: 'releaseCumecs',
    label: 'Controlled release',
    unit: 'm³/s',
    min: 0,
    max: 400,
    step: 1,
    default: 12,
    decimals: 0,
    group: 'Operation',
    note: 'Flow released through the outlet works, for downstream environmental and riparian needs. Pre-releasing ahead of rain creates headroom but spends water you may need later.',
  },
  {
    key: 'dailyDemandMcm',
    label: 'Water demand',
    unit: 'Mm³/day',
    min: 0,
    max: 5,
    step: 0.05,
    default: 0.8,
    decimals: 2,
    group: 'Operation',
    note: 'Abstraction for supply. Roughly 0.8 Mm³/day serves a few million people at typical per-capita use.',
  },
  {
    key: 'distributionEfficiencyPercent',
    label: 'Distribution efficiency',
    unit: '%',
    min: 40,
    max: 100,
    step: 1,
    default: 72,
    decimals: 0,
    group: 'Operation',
    note: 'Share of abstracted water that reaches users. The rest is leakage. Many large networks lose 20–40 %, so this is often the cheapest available supply.',
  },
  {
    key: 'seepagePercentPerDay',
    label: 'Seepage',
    unit: '%/day',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.05,
    decimals: 2,
    group: 'Operation',
    note: 'Daily loss through the dam and bed as a share of storage.',
  },
  {
    key: 'floodThresholdPercent',
    label: 'Flood-warning level',
    unit: '% of capacity',
    min: 50,
    max: 100,
    step: 1,
    default: 92,
    decimals: 0,
    group: 'Operation',
    note: 'Storage above which the operator would issue a warning. A reservoir-level threshold, not a downstream inundation forecast.',
  },
  {
    key: 'temperatureAnomalyK',
    label: 'Temperature anomaly',
    unit: 'K',
    min: -2,
    max: 6,
    step: 0.1,
    default: 0,
    decimals: 1,
    group: 'Climate',
    sharedKey: 'temperatureAnomalyK',
    note: 'Offset applied to the observed temperature, raising open-water evaporation by about 6 % per kelvin. Shared with Climate, Forest and AgriFuture.',
  },
]

const METRICS: MetricDefinition[] = [
  { key: 'storageMcm', label: 'Storage', unit: 'Mm³', kind: 'model', decimals: 1, headline: true },
  { key: 'fillPercent', label: 'Capacity utilisation', unit: '%', kind: 'model', decimals: 1, headline: true },
  { key: 'waterLevelM', label: 'Water level', unit: 'm', kind: 'model', decimals: 2, headline: true, note: 'Derived from storage through the stage-storage relation S/S_max = (h/h_max)^2. Not a gauge reading.' },
  { key: 'spillDays', label: 'Days spilling', unit: 'days', kind: 'model', decimals: 0, lowerIsBetter: true, headline: true },
  { key: 'daysAboveFloodThreshold', label: 'Days above warning level', unit: 'days', kind: 'model', decimals: 0, lowerIsBetter: true },
  { key: 'deficitDays', label: 'Days with unmet demand', unit: 'days', kind: 'model', decimals: 0, lowerIsBetter: true },
  { key: 'totalSpillMcm', label: 'Total spill', unit: 'Mm³', kind: 'model', decimals: 1, lowerIsBetter: true, note: 'Water that left over the spillway because storage was full — supply lost, and the clearest sign of mistimed operation.' },
  { key: 'unmetDemandMcm', label: 'Unmet demand', unit: 'Mm³', kind: 'model', decimals: 2, lowerIsBetter: true },
  { key: 'totalInflowMcm', label: 'Total inflow', unit: 'Mm³', kind: 'model', decimals: 1 },
  { key: 'totalEvaporationMcm', label: 'Evaporation loss', unit: 'Mm³', kind: 'model', decimals: 2, lowerIsBetter: true },
  { key: 'leakageMcm', label: 'Distribution leakage', unit: 'Mm³', kind: 'model', decimals: 2, lowerIsBetter: true, note: 'Water abstracted from storage that never reached a user.' },
  { key: 'minStorageMcm', label: 'Lowest storage', unit: 'Mm³', kind: 'model', decimals: 1 },
  { key: 'observedRainfallMm', label: 'Observed rainfall in span', unit: 'mm', kind: 'observation', decimals: 1, sourceId: 'open-meteo-forecast', note: 'The unscaled provider series over the simulated period. Model inflow uses this times the rainfall lever.' },
  { key: 'glofasDischargeCumecs', label: 'GloFAS discharge today', unit: 'm³/s', kind: 'forecast', decimals: 2, sourceId: 'open-meteo-flood' },
  { key: 'gaugeDischargeCumecs', label: 'Observed gauge discharge', unit: 'm³/s', kind: 'observation', decimals: 2, sourceId: 'usgs-nwis' },
]

const SERIES: SeriesKey[] = [
  { key: 'storage', label: 'Storage', unit: 'Mm³', colour: '#0EA5E9' },
  { key: 'level', label: 'Water level', unit: 'm', colour: '#1E6E95' },
  { key: 'fill', label: 'Capacity utilisation', unit: '%', colour: '#7DD3FC' },
  { key: 'rainfall', label: 'Rainfall', unit: 'mm/day', colour: '#8CA8B5', secondaryAxis: true },
  { key: 'inflow', label: 'Inflow', unit: 'Mm³/day', colour: '#64816C', secondaryAxis: true },
  { key: 'spill', label: 'Spill', unit: 'Mm³/day', colour: '#C25E3A', secondaryAxis: true },
]

const PRESETS: ScenarioPreset[] = [
  {
    id: 'normal',
    label: 'Normal operation',
    kind: 'baseline',
    description: 'Observed rainfall, standard release and demand.',
    overrides: { precipitationScalePercent: 100, releaseCumecs: 12, dailyDemandMcm: 0.8, initialFillPercent: 62, temperatureAnomalyK: 0 },
  },
  {
    id: 'extreme-rain',
    label: 'Extreme rainfall',
    kind: 'alternative',
    description: 'Rainfall at three times the observed series against a reservoir already 85 % full.',
    overrides: { precipitationScalePercent: 300, initialFillPercent: 85, releaseCumecs: 12, dailyDemandMcm: 0.8 },
  },
  {
    id: 'prerelease',
    label: 'Pre-release for headroom',
    kind: 'alternative',
    description: 'The same extreme rainfall, but the operator draws the reservoir down first and releases harder. Spill falls; so does the water left in store.',
    overrides: { precipitationScalePercent: 300, initialFillPercent: 60, releaseCumecs: 45, dailyDemandMcm: 0.8 },
  },
  {
    id: 'drought',
    label: 'Drought',
    kind: 'alternative',
    description: 'Rainfall at 30 % of observed with 2 K of added warmth driving evaporation.',
    overrides: { precipitationScalePercent: 30, temperatureAnomalyK: 2, initialFillPercent: 55, dailyDemandMcm: 0.8 },
  },
  {
    id: 'leak-reduction',
    label: 'Leakage reduction',
    kind: 'optimised',
    description: 'Distribution efficiency raised from 72 % to 92 % under drought. The same service from much less abstraction.',
    overrides: { precipitationScalePercent: 30, temperatureAnomalyK: 2, initialFillPercent: 55, distributionEfficiencyPercent: 92, dailyDemandMcm: 0.8 },
  },
]

/** Rainfall for a simulated day, cycling the observed series if the run is longer. */
export function rainfallForDay(baseline: WaterBaseline, day: number, scalePercent: number): number {
  if (baseline.dailyRainfallMm.length === 0) return 0
  const value = baseline.dailyRainfallMm[day % baseline.dailyRainfallMm.length]
  return (value ?? 0) * (scalePercent / 100)
}

export const waterEngine: SimulationEngine<WaterState, WaterBaseline> = {
  id: 'water',
  label: 'Reservoir water-balance engine',
  tickHours: 24,
  defaultDurationHours: 90 * 24,
  timeUnit: 'days',
  parameters: PARAMETERS,
  metrics: METRICS,
  series: SERIES,
  presets: PRESETS,
  disclaimer:
    'A lumped reservoir storage balance, stepped daily. It is bookkeeping on a single bucket: it has no channel routing, no hydraulics and no floodplain, so it cannot forecast inundation. The flood indicator is a reservoir-level threshold exceedance, which is a far weaker statement than a flood forecast. Observed rainfall, GloFAS discharge and USGS gauge readings are shown separately and are never mixed into the model output.',
  assumptions: [
    'Inflow uses the rational runoff-coefficient method, Q = C·P·A. The coefficient is a single lumped constant covering soil, slope, land cover and how wet the catchment already was.',
    'All rainfall-driven runoff arrives within the same day. There is no routing delay, which matters enormously for a large catchment.',
    'Stage-storage follows S/S_max = (h/h_max)², a valley-reservoir approximation. Surface area shrinks with level accordingly.',
    'Evaporation uses a base rate of 4 mm/day at 20 °C scaled 6 % per kelvin. A real estimate would use Penman with radiation, humidity and wind.',
    'Water in excess of capacity is spilled instantaneously and completely; a real spillway has a rating curve and finite capacity.',
    'Demand not met by storage is reported as unmet rather than drawing storage negative.',
    'When the run is longer than the observed rainfall series, the series repeats. Repeated weather is not a forecast.',
  ],

  init(params) {
    const capacity = params.capacityMcm
    const storage = capacity * (params.initialFillPercent / 100)
    return {
      day: 0,
      storageMcm: storage,
      cumulative: {
        rainfallInflow: 0,
        baseInflow: 0,
        release: 0,
        demandSupplied: 0,
        evaporation: 0,
        seepage: 0,
        spill: 0,
        unmetDemand: 0,
      },
      spillDays: 0,
      deficitDays: 0,
      daysAboveFloodThreshold: 0,
      minStorageMcm: storage,
      maxStorageMcm: storage,
    }
  },

  step(state, params, baseline, tickHours) {
    const days = tickHours / 24
    const geometry = geometryFor(params.capacityMcm)
    const rainfallMm = rainfallForDay(baseline, state.day, params.precipitationScalePercent)
    const temperatureC = (baseline.meanTemperatureC ?? 20) + params.temperatureAnomalyK

    const result = stepReservoir(state.storageMcm, geometry, {
      rainfallMm,
      catchmentAreaKm2: params.catchmentAreaKm2,
      runoffCoefficient: params.runoffCoefficient,
      baseInflowCumecs: params.baseInflowCumecs,
      releaseCumecs: params.releaseCumecs,
      dailyDemandMcm: params.dailyDemandMcm,
      distributionEfficiency: params.distributionEfficiencyPercent / 100,
      temperatureC,
      seepageFractionPerDay: params.seepagePercentPerDay / 100,
    }, days)

    const floodThresholdMcm = params.capacityMcm * (params.floodThresholdPercent / 100)

    return {
      day: state.day + days,
      storageMcm: result.storageMcm,
      cumulative: {
        rainfallInflow: state.cumulative.rainfallInflow + result.fluxes.rainfallInflow,
        baseInflow: state.cumulative.baseInflow + result.fluxes.baseInflow,
        release: state.cumulative.release + result.fluxes.release,
        demandSupplied:
          state.cumulative.demandSupplied + (result.fluxes.demand - result.unmetDemandMcm),
        evaporation: state.cumulative.evaporation + result.fluxes.evaporation,
        seepage: state.cumulative.seepage + result.fluxes.seepage,
        spill: state.cumulative.spill + result.fluxes.spill,
        unmetDemand: state.cumulative.unmetDemand + result.unmetDemandMcm,
      },
      spillDays: state.spillDays + (result.spilled ? days : 0),
      deficitDays: state.deficitDays + (result.unmetDemandMcm > 0 ? days : 0),
      daysAboveFloodThreshold:
        state.daysAboveFloodThreshold + (result.storageMcm >= floodThresholdMcm ? days : 0),
      minStorageMcm: Math.min(state.minStorageMcm, result.storageMcm),
      maxStorageMcm: Math.max(state.maxStorageMcm, result.storageMcm),
    }
  },

  derive(state, params, baseline) {
    const geometry = geometryFor(params.capacityMcm)
    const observedWindow = baseline.dailyRainfallMm.slice(0, Math.max(Math.round(state.day), 1))
    const efficiency = params.distributionEfficiencyPercent / 100

    return {
      storageMcm: state.storageMcm,
      fillPercent: params.capacityMcm > 0 ? (state.storageMcm / params.capacityMcm) * 100 : null,
      waterLevelM: levelFromStorage(state.storageMcm, geometry),
      spillDays: state.spillDays,
      daysAboveFloodThreshold: state.daysAboveFloodThreshold,
      deficitDays: state.deficitDays,
      totalSpillMcm: state.cumulative.spill,
      unmetDemandMcm: state.cumulative.unmetDemand,
      totalInflowMcm: state.cumulative.rainfallInflow + state.cumulative.baseInflow,
      totalEvaporationMcm: state.cumulative.evaporation,
      leakageMcm: state.cumulative.demandSupplied * (1 - efficiency),
      minStorageMcm: state.minStorageMcm,
      observedRainfallMm:
        observedWindow.length > 0 ? observedWindow.reduce((sum, value) => sum + value, 0) : null,
      glofasDischargeCumecs: baseline.glofasDischargeCumecs,
      gaugeDischargeCumecs: baseline.gaugeDischargeCumecs,
    }
  },

  sample(state, params, baseline) {
    const geometry = geometryFor(params.capacityMcm)
    const rainfallMm = rainfallForDay(baseline, Math.max(Math.round(state.day) - 1, 0), params.precipitationScalePercent)
    return {
      t: Number(state.day.toFixed(2)),
      storage: Number(state.storageMcm.toFixed(3)),
      level: Number(levelFromStorage(state.storageMcm, geometry).toFixed(3)),
      fill: params.capacityMcm > 0 ? Number(((state.storageMcm / params.capacityMcm) * 100).toFixed(2)) : null,
      rainfall: Number(rainfallMm.toFixed(2)),
      inflow: Number(
        (state.cumulative.rainfallInflow + state.cumulative.baseInflow).toFixed(3),
      ),
      spill: Number(state.cumulative.spill.toFixed(3)),
    } satisfies SeriesRow
  },

  explain(state, params, baseline) {
    const geometry = geometryFor(params.capacityMcm)
    const temperatureC = (baseline.meanTemperatureC ?? 20) + params.temperatureAnomalyK
    const rainfallMm = rainfallForDay(baseline, Math.max(Math.round(state.day) - 1, 0), params.precipitationScalePercent)
    const area = surfaceAreaFromStorage(state.storageMcm, geometry)
    const r = (value: number, decimals = 2) => value.toFixed(decimals)

    return [
      `Rainfall today = ${r(rainfallMm / Math.max(params.precipitationScalePercent / 100, 1e-6), 1)} mm observed × ${params.precipitationScalePercent}% lever = ${r(rainfallMm, 1)} mm`,
      `Runoff inflow = C·P·A = ${params.runoffCoefficient} × ${r(rainfallMm, 1)} mm × ${params.catchmentAreaKm2} km² = ${r((params.runoffCoefficient * rainfallMm * params.catchmentAreaKm2) / 1000, 3)} Mm³`,
      `Baseflow = ${params.baseInflowCumecs} m³/s × 86 400 s = ${r((params.baseInflowCumecs * 86400) / 1e6, 3)} Mm³/day`,
      `Abstraction = ${params.dailyDemandMcm} Mm³/day ÷ ${params.distributionEfficiencyPercent}% efficiency = ${r(params.dailyDemandMcm / (params.distributionEfficiencyPercent / 100), 3)} Mm³/day drawn from storage`,
      `Evaporation = ${r(evaporationRateMmPerDay(temperatureC), 2)} mm/day at ${r(temperatureC, 1)} °C × ${r(area, 3)} km² surface = ${r((evaporationRateMmPerDay(temperatureC) * area) / 1000, 4)} Mm³/day`,
      `Seepage = ${params.seepagePercentPerDay}% of ${r(state.storageMcm, 1)} Mm³ = ${r(state.storageMcm * (params.seepagePercentPerDay / 100), 4)} Mm³/day`,
      `Storage after ${r(state.day, 0)} days = ${r(state.storageMcm, 1)} Mm³ of ${params.capacityMcm} Mm³ (${r((state.storageMcm / params.capacityMcm) * 100, 1)}%)`,
      `Level from stage-storage S/S_max = (h/h_max)²: h = ${r(geometry.depthAtFullM, 1)} m × √(fill) = ${r(levelFromStorage(state.storageMcm, geometry), 2)} m`,
      `Cumulative spill = ${r(state.cumulative.spill, 2)} Mm³ over ${r(state.spillDays, 0)} day(s); unmet demand = ${r(state.cumulative.unmetDemand, 3)} Mm³ over ${r(state.deficitDays, 0)} day(s)`,
    ]
  },

  elapsedHours(state) {
    return state.day * 24
  },
}
