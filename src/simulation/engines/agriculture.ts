/**
 * Precision irrigation engine.
 *
 * A daily FAO-56 root-zone water balance. The Phase 1 version computed a
 * static requirement; this one tracks soil water through time, which is what
 * makes the irrigation *strategy* — how much, how often, triggered by what —
 * a meaningful thing to compare.
 *
 * The critical addition is the water-stress coefficient Ks (FAO-56 eq. 84):
 * once depletion passes the readily available water, the crop cannot transpire
 * at its potential rate. That single term is what turns a spreadsheet into a
 * simulation, because under-irrigation now has a visible, accumulating
 * consequence instead of simply producing a smaller number.
 *
 * It remains a water balance. There is no crop growth model here and no yield
 * prediction of any kind.
 *
 * Reference: Allen, Pereira, Raes & Smith (1998), FAO Irrigation and Drainage
 * Paper 56. https://www.fao.org/4/x0490e/x0490e00.htm
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
  SOIL_TEXTURES,
  growingDegreeDays,
  readilyAvailableWaterMm,
  soilTextureById,
  stepSoilWater,
  totalAvailableWaterMm,
  type SoilProfile,
} from '../models/waterBalance.ts'

export interface AgricultureBaseline extends EngineBaseline {
  /** Daily reference evapotranspiration for the span, mm. */
  dailyEt0Mm: number[]
  /** Daily precipitation for the span, mm. */
  dailyRainfallMm: number[]
  /** Daily mean temperature for the span, °C. */
  dailyMeanTemperatureC: number[]
  /** Observed volumetric soil moisture, 0–7 cm, m³/m³. Often unavailable. */
  observedSoilMoisture: number | null
  /** NASA POWER mean irradiance, kWh/m²/day. */
  meanIrradianceKwhPerM2Day: number | null
  locationLabel: string
}

export const EMPTY_AGRICULTURE_BASELINE: AgricultureBaseline = {
  dailyEt0Mm: [],
  dailyRainfallMm: [],
  dailyMeanTemperatureC: [],
  observedSoilMoisture: null,
  meanIrradianceKwhPerM2Day: null,
  locationLabel: 'No location',
  provenance: ['No observed agronomic data loaded yet.'],
  seededFromObservation: false,
}

/** FAO-56 Table 12 mid-season crop coefficients, with base temperatures. */
export const CROPS: { id: number; label: string; kcMid: number; baseTempC: number; rootingDepthM: number; note: string }[] = [
  { id: 0, label: 'Wheat', kcMid: 1.15, baseTempC: 0, rootingDepthM: 1.2, note: 'FAO-56 Table 12, winter wheat mid-season. Base temperature 0 °C.' },
  { id: 1, label: 'Maize (grain)', kcMid: 1.2, baseTempC: 10, rootingDepthM: 1.2, note: 'FAO-56 Table 12, field maize mid-season. Base temperature 10 °C.' },
  { id: 2, label: 'Rice (paddy)', kcMid: 1.2, baseTempC: 10, rootingDepthM: 0.6, note: 'FAO-56 Table 12. Excludes percolation losses, which dominate in puddled paddy — this balance will understate paddy water use substantially.' },
  { id: 3, label: 'Cotton', kcMid: 1.175, baseTempC: 15, rootingDepthM: 1.4, note: 'FAO-56 Table 12, midpoint of the published 1.15–1.20 mid-season range.' },
  { id: 4, label: 'Tomato (field)', kcMid: 1.15, baseTempC: 10, rootingDepthM: 1.0, note: 'FAO-56 Table 12, mid-season.' },
  { id: 5, label: 'Reference grass', kcMid: 1.0, baseTempC: 0, rootingDepthM: 0.5, note: 'The ET₀ reference surface itself — a baseline, not a crop.' },
]

export function cropById(id: number) {
  return CROPS.find((crop) => crop.id === id) ?? CROPS[0]
}

/** Irrigation scheduling strategies. */
export const STRATEGIES: { id: number; label: string; note: string }[] = [
  { id: 0, label: 'Fixed calendar schedule', note: 'Irrigates a set depth every N days regardless of soil state. Simple and common; wastes water after rain and leaves the crop short in a heatwave.' },
  { id: 1, label: 'Soil-moisture triggered', note: 'Irrigates only when depletion reaches the readily available water threshold — the point at which the crop would start to experience stress.' },
  { id: 2, label: 'Deficit irrigation', note: 'Deliberately irrigates at a fraction of full demand, accepting some stress to save water. A real agronomic practice with a real cost.' },
  { id: 3, label: 'Rainfed only', note: 'No irrigation at all. The comparison baseline for whether irrigation is worth its water.' },
]

export interface AgricultureState {
  day: number
  /** Root-zone depletion below field capacity, mm. */
  depletionMm: number
  /** Days since the last irrigation event. */
  daysSinceIrrigation: number
  cumulative: {
    appliedIrrigationMm: number
    netIrrigationMm: number
    effectiveRainfallMm: number
    etcPotentialMm: number
    etcActualMm: number
    deepPercolationMm: number
  }
  irrigationEvents: number
  /** Days on which Ks fell below 1, i.e. the crop was water-limited. */
  stressDays: number
  /** Sum of (1 − Ks) over the run — cumulative stress intensity. */
  stressIntegral: number
  growingDegreeDays: number
  minKs: number
  lastKs: number
  lastVolumetricWaterContent: number
}

const PARAMETERS: ParameterSpec[] = [
  {
    key: 'crop',
    label: 'Crop',
    unit: '',
    min: 0,
    max: 5,
    step: 1,
    default: 1,
    group: 'Crop',
    options: CROPS.map((crop) => ({ value: crop.id, label: crop.label })),
    note: 'Sets the FAO-56 mid-season crop coefficient, rooting depth and base temperature for degree-day accumulation.',
  },
  {
    key: 'kc',
    label: 'Crop coefficient Kc',
    unit: '',
    min: 0.3,
    max: 1.4,
    step: 0.05,
    default: 1.2,
    decimals: 2,
    group: 'Crop',
    note: 'FAO-56 Table 12 mid-season value, selected by crop above. Early and late growth stages need lower values, so a season-long run at mid-season Kc over-estimates total demand.',
  },
  {
    key: 'soilTexture',
    label: 'Soil texture',
    unit: '',
    min: 0,
    max: 4,
    step: 1,
    default: 2,
    group: 'Soil',
    options: SOIL_TEXTURES.map((texture) => ({ value: texture.id, label: texture.label })),
    note: 'FAO-56 Table 19 water-holding properties. Texture sets how much water the root zone can hold and how much of it the crop can actually extract.',
  },
  {
    key: 'rootingDepthM',
    label: 'Effective rooting depth',
    unit: 'm',
    min: 0.2,
    max: 2,
    step: 0.1,
    default: 1.2,
    decimals: 1,
    group: 'Soil',
    note: 'Depth the crop draws water from. Deeper roots buffer dry spells; shallow-rooted crops on sandy soil need frequent small irrigations.',
  },
  {
    key: 'depletionFraction',
    label: 'Depletion fraction p',
    unit: '',
    min: 0.2,
    max: 0.8,
    step: 0.05,
    default: 0.5,
    decimals: 2,
    group: 'Soil',
    note: 'FAO-56 Table 22. The share of total available water the crop can use before transpiration becomes limited.',
  },
  {
    key: 'strategy',
    label: 'Irrigation strategy',
    unit: '',
    min: 0,
    max: 3,
    step: 1,
    default: 0,
    group: 'Irrigation',
    options: STRATEGIES.map((strategy) => ({ value: strategy.id, label: strategy.label })),
    note: 'How irrigation is scheduled. This is the parameter that most changes both water use and crop stress.',
  },
  {
    key: 'irrigationDepthMm',
    label: 'Application depth',
    unit: 'mm',
    min: 5,
    max: 120,
    step: 5,
    default: 40,
    decimals: 0,
    group: 'Irrigation',
    note: 'Depth applied at the field gate per event. Applying more than the root zone can hold simply drains below it.',
  },
  {
    key: 'irrigationIntervalDays',
    label: 'Calendar interval',
    unit: 'days',
    min: 1,
    max: 30,
    step: 1,
    default: 7,
    decimals: 0,
    group: 'Irrigation',
    note: 'Used by the fixed calendar strategy only. Ignored by the triggered and rainfed strategies.',
  },
  {
    key: 'deficitFraction',
    label: 'Deficit fraction',
    unit: '',
    min: 0.3,
    max: 1,
    step: 0.05,
    default: 0.7,
    decimals: 2,
    group: 'Irrigation',
    note: 'Used by the deficit strategy: the share of full demand applied. Below about 0.6 most crops experience sustained stress.',
  },
  {
    key: 'applicationEfficiencyPercent',
    label: 'Application efficiency',
    unit: '%',
    min: 40,
    max: 95,
    step: 1,
    default: 75,
    decimals: 0,
    group: 'Irrigation',
    note: 'Share of applied water reaching the root zone. Surface irrigation is typically 60–80 %; well-managed drip reaches about 90 %.',
  },
  {
    key: 'effectiveRainfallPercent',
    label: 'Effective rainfall fraction',
    unit: '%',
    min: 30,
    max: 100,
    step: 5,
    default: 75,
    decimals: 0,
    group: 'Irrigation',
    note: 'Share of rainfall reaching the root zone rather than running off or evaporating. A planning assumption, not a site measurement.',
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
    note: 'Raises reference evapotranspiration by 3 % per kelvin and accumulates degree days faster. Shared with Climate, Forest and AquaGuard.',
  },
  {
    key: 'precipitationScalePercent',
    label: 'Rainfall scaling',
    unit: '%',
    min: 0,
    max: 300,
    step: 5,
    default: 100,
    decimals: 0,
    group: 'Climate',
    sharedKey: 'precipitationScalePercent',
    note: 'Scales the observed and forecast rainfall series. Shared with Climate, AquaGuard and Forest.',
  },
]

/**
 * Sensitivity of reference evapotranspiration to temperature.
 *
 * ET₀ rises with temperature mainly through the saturation vapour-pressure
 * deficit. 3 %/K is a mid-range value from published Penman-Monteith
 * sensitivity analyses; the real figure depends strongly on humidity, wind and
 * radiation, none of which this lever changes.
 */
export const ET0_SENSITIVITY_PER_K = 0.03

const METRICS: MetricDefinition[] = [
  { key: 'totalIrrigationMm', label: 'Irrigation applied', unit: 'mm', kind: 'model', decimals: 1, headline: true, lowerIsBetter: true },
  { key: 'irrigationLitresPerHectare', label: 'Water applied per hectare', unit: 'L/ha', kind: 'model', decimals: 0, lowerIsBetter: true, note: '1 mm over 1 hectare is 10 000 litres.' },
  { key: 'stressDays', label: 'Days under water stress', unit: 'days', kind: 'model', decimals: 0, headline: true, lowerIsBetter: true, note: 'Days when depletion exceeded the readily available water, so the crop could not transpire at its potential rate.' },
  { key: 'stressIntegral', label: 'Cumulative stress', unit: 'day-units', kind: 'model', decimals: 2, lowerIsBetter: true, note: 'Sum of (1 − Ks) over the run. Captures both how long and how severely the crop was short of water.' },
  { key: 'waterProductivity', label: 'Transpiration per unit applied', unit: 'mm/mm', kind: 'model', decimals: 3, headline: true, note: 'Actual crop transpiration divided by irrigation applied at the gate. Higher means more of the water you pumped reached the plant rather than draining or evaporating.' },
  { key: 'etcActualMm', label: 'Actual crop transpiration', unit: 'mm', kind: 'model', decimals: 1 },
  { key: 'etcPotentialMm', label: 'Potential crop demand', unit: 'mm', kind: 'model', decimals: 1 },
  { key: 'deficitMm', label: 'Unmet crop demand', unit: 'mm', kind: 'model', decimals: 1, lowerIsBetter: true, note: 'Potential minus actual transpiration: the water the crop wanted and did not get.' },
  { key: 'deepPercolationMm', label: 'Drained below root zone', unit: 'mm', kind: 'model', decimals: 1, lowerIsBetter: true, note: 'Water that passed below the roots. Wasted from the crop\'s point of view, and the main route by which irrigation leaches nutrients.' },
  { key: 'effectiveRainfallMm', label: 'Effective rainfall', unit: 'mm', kind: 'model', decimals: 1 },
  { key: 'irrigationEvents', label: 'Irrigation events', unit: 'events', kind: 'model', decimals: 0 },
  { key: 'finalSoilMoisture', label: 'Soil water content at end', unit: 'm³/m³', kind: 'model', decimals: 3 },
  { key: 'growingDegreeDays', label: 'Growing degree days', unit: '°C·day', kind: 'model', decimals: 0, note: 'Thermal time accumulated above the crop base temperature. Tracks development pace. It says nothing about yield.' },
  { key: 'observedSoilMoisture', label: 'Observed soil moisture', unit: 'm³/m³', kind: 'observation', decimals: 3, sourceId: 'open-meteo-forecast', note: 'Provider value for the 0–7 cm layer, where available. Shown for comparison; the model tracks the whole root zone, which behaves differently.' },
  { key: 'observedIrradiance', label: 'Observed irradiance', unit: 'kWh/m²/day', kind: 'historical', decimals: 2, sourceId: 'nasa-power' },
]

const SERIES: SeriesKey[] = [
  { key: 'soilMoisture', label: 'Root-zone water content', unit: 'm³/m³', colour: '#84CC16' },
  { key: 'depletion', label: 'Depletion', unit: 'mm', colour: '#C39A62', secondaryAxis: true },
  { key: 'ks', label: 'Stress coefficient Ks', unit: '', colour: '#C25E3A' },
  { key: 'irrigation', label: 'Irrigation applied', unit: 'mm', colour: '#3B82F6', secondaryAxis: true },
  { key: 'rainfall', label: 'Rainfall', unit: 'mm', colour: '#8CA8B5', secondaryAxis: true },
  { key: 'etc', label: 'Actual transpiration', unit: 'mm', colour: '#64816C', secondaryAxis: true },
]

const PRESETS: ScenarioPreset[] = [
  {
    id: 'calendar',
    label: 'Fixed calendar schedule',
    kind: 'baseline',
    description: '40 mm every 7 days at 75 % application efficiency. Conventional surface irrigation practice.',
    overrides: { strategy: 0, irrigationDepthMm: 40, irrigationIntervalDays: 7, applicationEfficiencyPercent: 75 },
  },
  {
    id: 'triggered',
    label: 'Soil-moisture triggered',
    kind: 'alternative',
    description: 'Same depth and efficiency, but irrigates only when the root zone actually needs it.',
    overrides: { strategy: 1, irrigationDepthMm: 40, applicationEfficiencyPercent: 75 },
  },
  {
    id: 'drip',
    label: 'Triggered drip',
    kind: 'optimised',
    description: 'Soil-moisture triggered with 90 % application efficiency and smaller, more frequent applications.',
    overrides: { strategy: 1, irrigationDepthMm: 25, applicationEfficiencyPercent: 90 },
  },
  {
    id: 'deficit',
    label: 'Deficit irrigation',
    kind: 'alternative',
    description: 'Deliberately applies 65 % of demand. Saves water and accepts stress — the trade-off is the point.',
    overrides: { strategy: 2, deficitFraction: 0.65, applicationEfficiencyPercent: 85 },
  },
  {
    id: 'rainfed',
    label: 'Rainfed',
    kind: 'alternative',
    description: 'No irrigation at all. The reference against which any irrigation scheme has to justify its water.',
    overrides: { strategy: 3 },
  },
  {
    id: 'drought',
    label: 'Drought stress test',
    kind: 'alternative',
    description: 'Calendar irrigation under +3 K and 40 % of normal rainfall.',
    overrides: { strategy: 0, temperatureAnomalyK: 3, precipitationScalePercent: 40 },
  },
]

function soilProfile(params: Record<string, number>): SoilProfile {
  const texture = soilTextureById(params.soilTexture)
  return {
    fieldCapacity: texture.profile.fieldCapacity,
    wiltingPoint: texture.profile.wiltingPoint,
    rootingDepthM: params.rootingDepthM,
    depletionFraction: params.depletionFraction,
  }
}

/** Reads a daily series, repeating it when the run is longer than the data. */
function seriesValue(series: number[], day: number, fallback: number): number {
  if (series.length === 0) return fallback
  return series[Math.floor(day) % series.length] ?? fallback
}

/** Irrigation depth to apply today, at the field gate, mm. */
export function scheduledIrrigationMm(
  state: AgricultureState,
  params: Record<string, number>,
  soil: SoilProfile,
  potentialEtcMm: number,
): number {
  switch (params.strategy) {
    case 0:
      return state.daysSinceIrrigation >= params.irrigationIntervalDays ? params.irrigationDepthMm : 0
    case 1: {
      // Trigger at the readily available water threshold — the point where
      // stress would otherwise begin.
      const raw = readilyAvailableWaterMm(soil)
      return state.depletionMm >= raw ? params.irrigationDepthMm : 0
    }
    case 2: {
      // Replace a fixed fraction of today's demand, every day.
      const efficiency = params.applicationEfficiencyPercent / 100
      return (potentialEtcMm * params.deficitFraction) / Math.max(efficiency, 0.1)
    }
    case 3:
    default:
      return 0
  }
}

export const agricultureEngine: SimulationEngine<AgricultureState, AgricultureBaseline> = {
  id: 'agriculture',
  label: 'FAO-56 irrigation engine',
  tickHours: 24,
  defaultDurationHours: 120 * 24,
  timeUnit: 'days',
  parameters: PARAMETERS,
  metrics: METRICS,
  series: SERIES,
  presets: PRESETS,
  disclaimer:
    'A daily FAO-56 root-zone water balance with the water-stress coefficient Ks. It models how much water the soil holds and the crop can extract. It contains no crop growth model and makes no yield prediction: stress days and cumulative stress describe water availability, not harvest.',
  assumptions: [
    'ET₀ is the provider\'s FAO-56 Penman-Monteith reference value for a short grass reference surface.',
    'Kc is the FAO-56 Table 12 mid-season value held constant for the whole run. Real seasons pass through initial, development, mid and late stages with much lower Kc at each end, so a season-long run at mid-season Kc over-estimates total demand.',
    'The water-stress coefficient follows FAO-56 eq. 84: Ks = (TAW − Dr)/(TAW − RAW) once depletion passes the readily available water.',
    'Soil water-holding properties come from FAO-56 Table 19 by texture. They are class averages, not measurements of your field.',
    'Water above field capacity drains below the root zone within the same day. There is no perched water table, no capillary rise and no lateral flow.',
    'Application and effective-rainfall efficiencies are planning assumptions you set, not site measurements.',
    `The temperature lever raises ET₀ by ${(ET0_SENSITIVITY_PER_K * 100).toFixed(0)} % per kelvin. The real sensitivity depends on humidity, wind and radiation, which this lever does not change.`,
    'Paddy rice is modelled as an upland crop: percolation losses, which dominate real puddled paddy water use, are not represented.',
    'When the run is longer than the observed weather series, the series repeats. Repeated weather is not a forecast.',
  ],

  init(params, baseline) {
    const soil = soilProfile(params)
    const taw = totalAvailableWaterMm(soil)
    // Start from the observed soil moisture where one exists; otherwise start
    // at field capacity and say so in the provenance rather than guessing.
    const depletionMm =
      baseline.observedSoilMoisture === null
        ? 0
        : Math.min(
            Math.max((soil.fieldCapacity - baseline.observedSoilMoisture) * 1000 * soil.rootingDepthM, 0),
            taw,
          )

    return {
      day: 0,
      depletionMm,
      daysSinceIrrigation: params.irrigationIntervalDays,
      cumulative: {
        appliedIrrigationMm: 0,
        netIrrigationMm: 0,
        effectiveRainfallMm: 0,
        etcPotentialMm: 0,
        etcActualMm: 0,
        deepPercolationMm: 0,
      },
      irrigationEvents: 0,
      stressDays: 0,
      stressIntegral: 0,
      growingDegreeDays: 0,
      minKs: 1,
      lastKs: 1,
      lastVolumetricWaterContent: soil.fieldCapacity - depletionMm / (1000 * soil.rootingDepthM),
    }
  },

  step(state, params, baseline, tickHours) {
    const days = tickHours / 24
    const soil = soilProfile(params)
    const crop = cropById(params.crop)

    const et0Raw = seriesValue(baseline.dailyEt0Mm, state.day, 4) * days
    const et0Mm = et0Raw * (1 + ET0_SENSITIVITY_PER_K * params.temperatureAnomalyK)
    const rainfallMm =
      seriesValue(baseline.dailyRainfallMm, state.day, 0) * days * (params.precipitationScalePercent / 100)
    const temperatureC =
      seriesValue(baseline.dailyMeanTemperatureC, state.day, 18) + params.temperatureAnomalyK

    const potentialEtcMm = params.kc * et0Mm
    const appliedIrrigationMm = scheduledIrrigationMm(state, params, soil, potentialEtcMm)

    const result = stepSoilWater(state.depletionMm, soil, {
      et0Mm,
      kc: params.kc,
      rainfallMm,
      effectiveRainfallFraction: params.effectiveRainfallPercent / 100,
      appliedIrrigationMm,
      applicationEfficiency: params.applicationEfficiencyPercent / 100,
    })

    const stressed = result.ks < 0.999

    return {
      day: state.day + days,
      depletionMm: result.depletionMm,
      daysSinceIrrigation: appliedIrrigationMm > 0 ? 0 : state.daysSinceIrrigation + days,
      cumulative: {
        appliedIrrigationMm: state.cumulative.appliedIrrigationMm + appliedIrrigationMm,
        netIrrigationMm: state.cumulative.netIrrigationMm + result.netIrrigationMm,
        effectiveRainfallMm: state.cumulative.effectiveRainfallMm + result.effectiveRainfallMm,
        etcPotentialMm: state.cumulative.etcPotentialMm + result.etcMm,
        etcActualMm: state.cumulative.etcActualMm + result.etcAdjustedMm,
        deepPercolationMm: state.cumulative.deepPercolationMm + result.deepPercolationMm,
      },
      irrigationEvents: state.irrigationEvents + (appliedIrrigationMm > 0 ? 1 : 0),
      stressDays: state.stressDays + (stressed ? days : 0),
      stressIntegral: state.stressIntegral + (1 - result.ks) * days,
      growingDegreeDays:
        state.growingDegreeDays + growingDegreeDays(temperatureC, crop.baseTempC, days),
      minKs: Math.min(state.minKs, result.ks),
      lastKs: result.ks,
      lastVolumetricWaterContent: result.volumetricWaterContent,
    }
  },

  derive(state, _params, baseline) {
    const applied = state.cumulative.appliedIrrigationMm
    return {
      totalIrrigationMm: applied,
      irrigationLitresPerHectare: applied * 10_000,
      stressDays: state.stressDays,
      stressIntegral: state.stressIntegral,
      waterProductivity: applied > 0 ? state.cumulative.etcActualMm / applied : null,
      etcActualMm: state.cumulative.etcActualMm,
      etcPotentialMm: state.cumulative.etcPotentialMm,
      deficitMm: state.cumulative.etcPotentialMm - state.cumulative.etcActualMm,
      deepPercolationMm: state.cumulative.deepPercolationMm,
      effectiveRainfallMm: state.cumulative.effectiveRainfallMm,
      irrigationEvents: state.irrigationEvents,
      finalSoilMoisture: state.lastVolumetricWaterContent,
      growingDegreeDays: state.growingDegreeDays,
      observedSoilMoisture: baseline.observedSoilMoisture,
      observedIrradiance: baseline.meanIrradianceKwhPerM2Day,
    }
  },

  sample(state, params, baseline) {
    const rainfallMm =
      seriesValue(baseline.dailyRainfallMm, Math.max(state.day - 1, 0), 0) *
      (params.precipitationScalePercent / 100)
    return {
      t: Number(state.day.toFixed(2)),
      soilMoisture: Number(state.lastVolumetricWaterContent.toFixed(4)),
      depletion: Number(state.depletionMm.toFixed(2)),
      ks: Number(state.lastKs.toFixed(3)),
      irrigation: Number(state.cumulative.appliedIrrigationMm.toFixed(2)),
      rainfall: Number(rainfallMm.toFixed(2)),
      etc: Number(state.cumulative.etcActualMm.toFixed(2)),
    } satisfies SeriesRow
  },

  explain(state, params, baseline) {
    const soil = soilProfile(params)
    const taw = totalAvailableWaterMm(soil)
    const raw = readilyAvailableWaterMm(soil)
    const texture = soilTextureById(params.soilTexture)
    const strategy = STRATEGIES.find((entry) => entry.id === params.strategy) ?? STRATEGIES[0]
    const et0Base = seriesValue(baseline.dailyEt0Mm, Math.max(state.day - 1, 0), 4)
    const r = (value: number, decimals = 2) => value.toFixed(decimals)

    return [
      `Soil: ${texture.label}, θ_FC ${soil.fieldCapacity} and θ_WP ${soil.wiltingPoint} m³/m³ over ${r(soil.rootingDepthM, 1)} m root zone`,
      `Total available water TAW = 1000 × (${soil.fieldCapacity} − ${soil.wiltingPoint}) × ${r(soil.rootingDepthM, 1)} = ${r(taw, 1)} mm`,
      `Readily available water RAW = p × TAW = ${soil.depletionFraction} × ${r(taw, 1)} = ${r(raw, 1)} mm — stress begins past this`,
      `ET₀ today = ${r(et0Base, 2)} mm observed × (1 + ${ET0_SENSITIVITY_PER_K} × ${r(params.temperatureAnomalyK, 1)} K) = ${r(et0Base * (1 + ET0_SENSITIVITY_PER_K * params.temperatureAnomalyK), 2)} mm`,
      `Potential crop demand ETc = Kc × ET₀ = ${r(params.kc, 2)} × ${r(et0Base * (1 + ET0_SENSITIVITY_PER_K * params.temperatureAnomalyK), 2)} = ${r(params.kc * et0Base * (1 + ET0_SENSITIVITY_PER_K * params.temperatureAnomalyK), 2)} mm`,
      `Strategy: ${strategy.label}. ${strategy.note}`,
      `Current depletion Dr = ${r(state.depletionMm, 1)} mm → Ks = ${r(state.lastKs, 3)} (1 means unstressed)`,
      `Actual transpiration ETc,adj = Ks × ETc; over the run ${r(state.cumulative.etcActualMm, 1)} mm actual against ${r(state.cumulative.etcPotentialMm, 1)} mm potential`,
      `Irrigation applied at the gate = ${r(state.cumulative.appliedIrrigationMm, 1)} mm over ${state.irrigationEvents} event(s); ${r(state.cumulative.netIrrigationMm, 1)} mm reached the root zone at ${params.applicationEfficiencyPercent}% efficiency`,
      `Drained below the root zone = ${r(state.cumulative.deepPercolationMm, 1)} mm`,
      `Water stress on ${r(state.stressDays, 0)} day(s), cumulative intensity ${r(state.stressIntegral, 2)}; lowest Ks reached ${r(state.minKs, 3)}`,
    ]
  },

  elapsedHours(state) {
    return state.day * 24
  },
}
