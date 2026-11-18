/**
 * Climate scenario engine.
 *
 * Anchors a zero-dimensional energy-balance model to this location's observed
 * ERA5 climatology, then evolves the *change* from today forward under a
 * user-chosen CO₂ pathway, cloud assumption and solar assumption.
 *
 * The framing matters: the model never claims to reproduce the observed record.
 * It takes the observed record as the starting point and projects an
 * illustrative departure from it. What it produces is the transient global-mean
 * response of a single heat reservoir — useful for intuition about forcing,
 * feedback and thermal inertia, and useless for anything regional.
 */

import type { EngineBaseline, MetricDefinition, ScenarioPreset, SeriesKey, SeriesRow, SimulationEngine } from '../types/engine.ts'
import type { ParameterSpec } from '../types/parameters.ts'
import {
  CO2_PATHWAYS,
  EQUILIBRIUM_SENSITIVITY,
  FEEDBACK_PARAMETER,
  FORCING_2X_CO2,
  co2Forcing,
  pathwayById,
  precipitationScaleFor,
  solarForcing,
  stepEnergyBalance,
} from '../models/radiativeForcing.ts'

/**
 * Global mean net cloud radiative effect is about −20 W/m² at roughly 67 %
 * mean cloud cover (CERES EBAF, Loeb et al. 2018), giving ≈ −0.3 W/m² per
 * percentage point. A linear term is a teaching device: real cloud feedback is
 * the largest single uncertainty in climate modelling and is not linear.
 */
export const CLOUD_FORCING_PER_PERCENT = -0.3

export interface ClimateBaseline extends EngineBaseline {
  /** ERA5 monthly means by calendar month index 0–11, °C. Null where absent. */
  monthlyTemperatureC: (number | null)[]
  /** ERA5 monthly precipitation totals by calendar month, mm. */
  monthlyPrecipitationMm: (number | null)[]
  /** Observed current 2 m temperature, °C. */
  currentTemperatureC: number | null
  /** Observed current cloud cover, %. */
  currentCloudCoverPercent: number | null
  /** NASA POWER mean all-sky irradiance, kWh/m²/day. */
  meanIrradianceKwhPerM2Day: number | null
  /** Annual mean of the ERA5 record, °C. */
  annualMeanTemperatureC: number | null
  /** Annual total of the ERA5 record, mm. */
  annualPrecipitationMm: number | null
  locationLabel: string
}

export const EMPTY_CLIMATE_BASELINE: ClimateBaseline = {
  monthlyTemperatureC: new Array(12).fill(null),
  monthlyPrecipitationMm: new Array(12).fill(null),
  currentTemperatureC: null,
  currentCloudCoverPercent: null,
  meanIrradianceKwhPerM2Day: null,
  annualMeanTemperatureC: null,
  annualPrecipitationMm: null,
  locationLabel: 'No location',
  provenance: ['No observed data has loaded yet.'],
  seededFromObservation: false,
}

export interface ClimateState {
  /** Simulated months completed. */
  month: number
  /** Warming beyond the starting anomaly, K. The EBM's state variable. */
  additionalWarmingK: number
  /** CO₂ concentration at this point in the run, ppm. */
  co2Ppm: number
  /** Total forcing anomaly relative to the run start, W/m². */
  forcingWm2: number
  /** Peak additional warming reached so far, K. */
  peakWarmingK: number
  /** Cumulative scenario precipitation since the run start, mm. */
  cumulativeScenarioPrecipMm: number
  /** Cumulative baseline precipitation over the same span, mm. */
  cumulativeBaselinePrecipMm: number
}

const PARAMETERS: ParameterSpec[] = [
  {
    key: 'temperatureAnomalyK',
    label: 'Starting temperature anomaly',
    unit: 'K',
    min: -2,
    max: 6,
    step: 0.1,
    default: 0,
    decimals: 1,
    group: 'Scenario',
    sharedKey: 'temperatureAnomalyK',
    note: 'A uniform offset applied to the observed record at the start of the run. Shared with Forest, AquaGuard and AgriFuture, where it drives fuel drying, evaporation and crop water demand.',
  },
  {
    key: 'precipitationScalePercent',
    label: 'Precipitation scaling',
    unit: '%',
    min: 30,
    max: 200,
    step: 5,
    default: 100,
    decimals: 0,
    group: 'Scenario',
    sharedKey: 'precipitationScalePercent',
    note: 'A uniform multiplier on the observed rainfall record. Real change alters intensity distribution, not just totals. Shared with AquaGuard and AgriFuture.',
  },
  {
    key: 'co2Pathway',
    label: 'CO₂ pathway',
    unit: '',
    min: 0,
    max: 4,
    step: 1,
    default: 1,
    group: 'Scenario',
    options: CO2_PATHWAYS.map((pathway) => ({ value: pathway.id, label: pathway.label })),
    note: 'Illustrative concentration pathways, not emissions scenarios and not CMIP6 runs. Each is a simple linear trend in concentration.',
  },
  {
    key: 'cloudCoverPercent',
    label: 'Mean cloud cover assumption',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    default: 60,
    decimals: 0,
    group: 'Radiative',
    seededFromObservation: true,
    note: 'Seeded from the observed cloud cover at this location. Changing it applies a linear cloud radiative forcing of −0.3 W/m² per percentage point.',
  },
  {
    key: 'solarChangePercent',
    label: 'Solar irradiance change',
    unit: '%',
    min: -2,
    max: 2,
    step: 0.05,
    default: 0,
    decimals: 2,
    group: 'Radiative',
    note: 'Fractional change in incident solar irradiance. The real 11-year solar cycle spans about 0.1 %; larger values are included to show the model\'s sensitivity, not because they are plausible.',
  },
  {
    key: 'durationYears',
    label: 'Simulated span',
    unit: 'years',
    min: 5,
    max: 100,
    step: 5,
    default: 50,
    decimals: 0,
    group: 'Run',
    note: 'How far forward the energy-balance model is integrated. Longer spans let thermal inertia play out; they do not make the result a projection.',
  },
]

const METRICS: MetricDefinition[] = [
  {
    key: 'observedCurrentTemperature',
    label: 'Observed temperature now',
    unit: '°C',
    kind: 'observation',
    decimals: 1,
    sourceId: 'open-meteo-forecast',
    headline: true,
    note: 'The provider\'s current 2 m temperature for this location. Not model output.',
  },
  {
    key: 'baselineAnnualMeanTemperature',
    label: 'ERA5 annual mean',
    unit: '°C',
    kind: 'historical',
    decimals: 2,
    sourceId: 'open-meteo-archive',
    headline: true,
    note: 'Mean of the retrieved ERA5 reanalysis record for this location. The simulation\'s starting point.',
  },
  {
    key: 'scenarioAnnualMeanTemperature',
    label: 'Scenario annual mean',
    unit: '°C',
    kind: 'illustrative',
    decimals: 2,
    headline: true,
    lowerIsBetter: true,
    note: 'ERA5 annual mean plus the starting anomaly plus the warming the energy-balance model accumulated over the run.',
  },
  {
    key: 'totalWarmingK',
    label: 'Total warming vs record',
    unit: 'K',
    kind: 'illustrative',
    decimals: 2,
    headline: true,
    lowerIsBetter: true,
    note: 'Starting anomaly plus modelled additional warming at the end of the run.',
  },
  {
    key: 'additionalWarmingK',
    label: 'Modelled additional warming',
    unit: 'K',
    kind: 'illustrative',
    decimals: 3,
    lowerIsBetter: true,
    note: 'Warming the one-box model accumulated during the run, excluding the starting offset.',
  },
  {
    key: 'co2Ppm',
    label: 'CO₂ at end of run',
    unit: 'ppm',
    kind: 'illustrative',
    decimals: 0,
    lowerIsBetter: true,
  },
  {
    key: 'forcingWm2',
    label: 'Radiative forcing anomaly',
    unit: 'W/m²',
    kind: 'model',
    decimals: 3,
    lowerIsBetter: true,
    note: 'Total forcing relative to the start of the run: CO₂ (Myhre fit) plus cloud and solar terms.',
  },
  {
    key: 'equilibriumWarmingK',
    label: 'Committed warming at equilibrium',
    unit: 'K',
    kind: 'model',
    decimals: 2,
    lowerIsBetter: true,
    note: 'F/λ — where this forcing would eventually take temperature if held constant. Always larger than the transient response, because the ocean is still absorbing heat.',
  },
  {
    key: 'baselineAnnualPrecipitation',
    label: 'ERA5 annual precipitation',
    unit: 'mm',
    kind: 'historical',
    decimals: 0,
    sourceId: 'open-meteo-archive',
  },
  {
    key: 'scenarioAnnualPrecipitation',
    label: 'Scenario annual precipitation',
    unit: 'mm',
    kind: 'illustrative',
    decimals: 0,
    note: 'ERA5 total scaled by the precipitation lever and by the hydrological sensitivity of 2 % per kelvin of modelled warming.',
  },
  {
    key: 'precipitationChangePercent',
    label: 'Precipitation change',
    unit: '%',
    kind: 'illustrative',
    decimals: 1,
  },
  {
    key: 'observedIrradiance',
    label: 'Observed mean irradiance',
    unit: 'kWh/m²/day',
    kind: 'historical',
    decimals: 2,
    sourceId: 'nasa-power',
    note: 'NASA POWER all-sky surface irradiance. Shown for context; it does not feed the energy-balance model, which uses the solar lever instead.',
  },
]

const SERIES: SeriesKey[] = [
  { key: 'baselineTemperature', label: 'ERA5 baseline temperature', unit: '°C', colour: '#8CA8B5' },
  { key: 'scenarioTemperature', label: 'Scenario temperature', unit: '°C', colour: '#3B82F6' },
  { key: 'warming', label: 'Warming above record', unit: 'K', colour: '#C25E3A' },
  { key: 'co2', label: 'CO₂ concentration', unit: 'ppm', colour: '#6E6A60', secondaryAxis: true },
  { key: 'forcing', label: 'Radiative forcing', unit: 'W/m²', colour: '#C39A62', secondaryAxis: true },
  { key: 'precipitation', label: 'Monthly precipitation', unit: 'mm', colour: '#64816C' },
]

const PRESETS: ScenarioPreset[] = [
  {
    id: 'observed',
    label: 'Observed baseline',
    kind: 'baseline',
    description: 'No anomaly, no scaling, CO₂ held at its present concentration. The observed record, carried forward.',
    overrides: { temperatureAnomalyK: 0, precipitationScalePercent: 100, co2Pathway: 0, solarChangePercent: 0 },
  },
  {
    id: 'trend',
    label: 'Recent trend continued',
    kind: 'alternative',
    description: 'CO₂ continues accumulating at the recent observed rate of about 2.4 ppm per year.',
    overrides: { temperatureAnomalyK: 0, precipitationScalePercent: 100, co2Pathway: 1, solarChangePercent: 0 },
  },
  {
    id: 'high',
    label: 'Higher accumulation',
    kind: 'alternative',
    description: 'A faster concentration pathway at about 3.5 ppm per year.',
    overrides: { temperatureAnomalyK: 0.3, precipitationScalePercent: 100, co2Pathway: 2, solarChangePercent: 0 },
  },
  {
    id: 'mitigation',
    label: 'Strong mitigation',
    kind: 'optimised',
    description: 'Accumulation slows markedly. Note that warming still continues for decades — the committed-warming metric shows why.',
    overrides: { temperatureAnomalyK: 0, precipitationScalePercent: 100, co2Pathway: 3, solarChangePercent: 0 },
  },
  {
    id: 'drought',
    label: 'Warm and dry',
    kind: 'alternative',
    description: 'Combines added warmth with a 35 % reduction in rainfall — the input combination that stresses AquaGuard and AgriFuture hardest.',
    overrides: { temperatureAnomalyK: 2, precipitationScalePercent: 65, co2Pathway: 2, cloudCoverPercent: 35 },
  },
]

const MONTH_HOURS = 730

function mean(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null)
  if (present.length === 0) return null
  return present.reduce((sum, value) => sum + value, 0) / present.length
}

export const climateEngine: SimulationEngine<ClimateState, ClimateBaseline> = {
  id: 'climate',
  label: 'Climate scenario engine',
  tickHours: MONTH_HOURS,
  defaultDurationHours: 50 * 8760,
  timeUnit: 'years',
  parameters: PARAMETERS,
  metrics: METRICS,
  series: SERIES,
  presets: PRESETS,
  disclaimer:
    'A zero-dimensional energy-balance model: one well-mixed heat reservoir, a logarithmic CO₂ forcing and a linear feedback. It has no spatial structure, no ocean circulation and no atmospheric dynamics, and it is not CMIP6. It reproduces the global-mean transient response to a forcing change, anchored to this location\'s observed record, and nothing more.',
  assumptions: [
    `Radiative forcing follows the Myhre et al. (1998) fit, ΔF = 5.35·ln(C/C₀) with C₀ = 278 ppm.`,
    `The climate feedback parameter is ${FEEDBACK_PARAMETER} W/m²/K, giving an equilibrium sensitivity of ${EQUILIBRIUM_SENSITIVITY.toFixed(2)} K for doubled CO₂ (${FORCING_2X_CO2.toFixed(2)} W/m²) — inside the IPCC AR6 likely range.`,
    'Effective heat capacity is 8.5 W·yr/m²/K, equivalent to a ~70 m ocean mixed layer. The deep ocean is absent, so this model approaches equilibrium faster than the real system.',
    'Cloud forcing is linear at −0.3 W/m² per percentage point of cover, derived from the CERES global mean net cloud radiative effect. Real cloud feedback is non-linear and is the largest uncertainty in climate modelling.',
    'Precipitation scales at 2 % per kelvin of modelled warming — the energy-budget-constrained hydrological sensitivity, not the ~7 %/K Clausius-Clapeyron moisture scaling that governs extremes.',
    'The local temperature is treated as the global-mean anomaly added to this location\'s climatology. Real warming is strongly non-uniform in space and season.',
    'CO₂ pathways are linear trends in concentration chosen for illustration. They are not emissions scenarios and carry no likelihood.',
  ],

  init(params) {
    const pathway = pathwayById(params.co2Pathway)
    return {
      month: 0,
      additionalWarmingK: 0,
      co2Ppm: pathway.startPpm,
      forcingWm2: 0,
      peakWarmingK: 0,
      cumulativeScenarioPrecipMm: 0,
      cumulativeBaselinePrecipMm: 0,
    }
  },

  step(state, params, baseline, tickHours) {
    const years = tickHours / 8760
    const pathway = pathwayById(params.co2Pathway)

    const co2Ppm = Math.max(state.co2Ppm + pathway.ppmPerYear * years, 10)

    // Forcing is always relative to the run's own starting concentration, so
    // the model describes the change from today rather than re-deriving the
    // warming that has already happened.
    const co2Anomaly = co2Forcing(co2Ppm) - co2Forcing(pathway.startPpm)
    const baselineCloud = baseline.currentCloudCoverPercent ?? 60
    const cloudAnomaly = CLOUD_FORCING_PER_PERCENT * (params.cloudCoverPercent - baselineCloud)
    const solarAnomaly = solarForcing(params.solarChangePercent / 100)
    const forcingWm2 = co2Anomaly + cloudAnomaly + solarAnomaly

    const additionalWarmingK = stepEnergyBalance(state.additionalWarmingK, forcingWm2, years)

    const monthIndex = state.month % 12
    const baselinePrecip = baseline.monthlyPrecipitationMm[monthIndex] ?? 0
    const scenarioPrecip =
      baselinePrecip *
      (params.precipitationScalePercent / 100) *
      precipitationScaleFor(additionalWarmingK)

    return {
      month: state.month + 1,
      additionalWarmingK,
      co2Ppm,
      forcingWm2,
      peakWarmingK: Math.max(state.peakWarmingK, additionalWarmingK),
      cumulativeScenarioPrecipMm: state.cumulativeScenarioPrecipMm + scenarioPrecip,
      cumulativeBaselinePrecipMm: state.cumulativeBaselinePrecipMm + baselinePrecip,
    }
  },

  derive(state, params, baseline) {
    const totalWarmingK = params.temperatureAnomalyK + state.additionalWarmingK
    const baselineAnnualMean = baseline.annualMeanTemperatureC
    const years = Math.max(state.month / 12, 1 / 12)

    const scenarioAnnualPrecip =
      state.cumulativeScenarioPrecipMm > 0 ? state.cumulativeScenarioPrecipMm / years : null
    const baselineAnnualPrecip =
      state.cumulativeBaselinePrecipMm > 0
        ? state.cumulativeBaselinePrecipMm / years
        : baseline.annualPrecipitationMm

    return {
      observedCurrentTemperature: baseline.currentTemperatureC,
      baselineAnnualMeanTemperature: baselineAnnualMean,
      scenarioAnnualMeanTemperature:
        baselineAnnualMean === null ? null : baselineAnnualMean + totalWarmingK,
      totalWarmingK,
      additionalWarmingK: state.additionalWarmingK,
      co2Ppm: state.co2Ppm,
      forcingWm2: state.forcingWm2,
      equilibriumWarmingK: state.forcingWm2 / FEEDBACK_PARAMETER,
      baselineAnnualPrecipitation: baselineAnnualPrecip,
      scenarioAnnualPrecipitation: scenarioAnnualPrecip,
      precipitationChangePercent:
        baselineAnnualPrecip === null || scenarioAnnualPrecip === null || baselineAnnualPrecip === 0
          ? null
          : ((scenarioAnnualPrecip - baselineAnnualPrecip) / baselineAnnualPrecip) * 100,
      observedIrradiance: baseline.meanIrradianceKwhPerM2Day,
    }
  },

  sample(state, params, baseline) {
    const monthIndex = state.month % 12
    const baselineTemperature = baseline.monthlyTemperatureC[monthIndex]
    const totalWarmingK = params.temperatureAnomalyK + state.additionalWarmingK
    const baselinePrecip = baseline.monthlyPrecipitationMm[monthIndex]

    return {
      t: Number((state.month / 12).toFixed(3)),
      baselineTemperature,
      scenarioTemperature: baselineTemperature === null ? null : baselineTemperature + totalWarmingK,
      warming: Number(totalWarmingK.toFixed(4)),
      co2: Number(state.co2Ppm.toFixed(1)),
      forcing: Number(state.forcingWm2.toFixed(4)),
      precipitation:
        baselinePrecip === null
          ? null
          : Number(
              (
                baselinePrecip *
                (params.precipitationScalePercent / 100) *
                precipitationScaleFor(state.additionalWarmingK)
              ).toFixed(2),
            ),
    } satisfies SeriesRow
  },

  explain(state, params, baseline) {
    const pathway = pathwayById(params.co2Pathway)
    const baselineCloud = baseline.currentCloudCoverPercent ?? 60
    const co2Anomaly = co2Forcing(state.co2Ppm) - co2Forcing(pathway.startPpm)
    const cloudAnomaly = CLOUD_FORCING_PER_PERCENT * (params.cloudCoverPercent - baselineCloud)
    const solarAnomaly = solarForcing(params.solarChangePercent / 100)
    const r = (value: number, decimals = 3) => value.toFixed(decimals)

    return [
      `CO₂ after ${(state.month / 12).toFixed(1)} yr = ${r(pathway.startPpm, 0)} ppm + ${pathway.ppmPerYear} ppm/yr × ${(state.month / 12).toFixed(1)} yr = ${r(state.co2Ppm, 1)} ppm`,
      `CO₂ forcing = 5.35 · ln(${r(state.co2Ppm, 1)} / ${r(pathway.startPpm, 0)}) = ${r(co2Anomaly)} W/m²`,
      `Cloud forcing = −0.3 W/m²/% × (${params.cloudCoverPercent}% − ${r(baselineCloud, 0)}% observed) = ${r(cloudAnomaly)} W/m²`,
      `Solar forcing = (1361/4)·(1 − 0.30)·${(params.solarChangePercent / 100).toFixed(4)} = ${r(solarAnomaly)} W/m²`,
      `Total forcing anomaly F = ${r(state.forcingWm2)} W/m²`,
      `Energy balance: C·dT/dt = F − λ·T, with C = 8.5 W·yr/m²/K and λ = ${FEEDBACK_PARAMETER} W/m²/K`,
      `Transient warming after ${(state.month / 12).toFixed(1)} yr = ${r(state.additionalWarmingK)} K`,
      `Equilibrium warming for this forcing = F/λ = ${r(state.forcingWm2)} / ${FEEDBACK_PARAMETER} = ${r(state.forcingWm2 / FEEDBACK_PARAMETER, 2)} K`,
      `Total vs the ERA5 record = ${r(params.temperatureAnomalyK, 1)} K starting offset + ${r(state.additionalWarmingK)} K modelled = ${r(params.temperatureAnomalyK + state.additionalWarmingK, 2)} K`,
      `Precipitation scale = ${params.precipitationScalePercent}% lever × (1 + 0.02 × ${r(state.additionalWarmingK, 2)} K) = ${r((params.precipitationScalePercent / 100) * precipitationScaleFor(state.additionalWarmingK), 3)}`,
    ]
  },

  elapsedHours(state) {
    return state.month * MONTH_HOURS
  },
}

/** Builds the engine baseline from the Phase 1 data hooks' output. */
export function buildClimateBaseline(input: {
  monthly: { month: string; temperatureMean: number | null; precipitationSum: number | null }[]
  currentTemperatureC: number | null
  currentCloudCoverPercent: number | null
  meanIrradianceKwhPerM2Day: number | null
  locationLabel: string
}): ClimateBaseline {
  const temperatureByMonth: number[][] = Array.from({ length: 12 }, () => [])
  const precipitationByMonth: number[][] = Array.from({ length: 12 }, () => [])

  for (const row of input.monthly) {
    const index = Number(row.month.slice(5, 7)) - 1
    if (index < 0 || index > 11) continue
    if (row.temperatureMean !== null) temperatureByMonth[index].push(row.temperatureMean)
    if (row.precipitationSum !== null) precipitationByMonth[index].push(row.precipitationSum)
  }

  const monthlyTemperatureC = temperatureByMonth.map((values) =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
  )
  const monthlyPrecipitationMm = precipitationByMonth.map((values) =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
  )

  const annualMeanTemperatureC = mean(monthlyTemperatureC)
  const presentPrecip = monthlyPrecipitationMm.filter((value): value is number => value !== null)
  const annualPrecipitationMm =
    presentPrecip.length === 12 ? presentPrecip.reduce((sum, value) => sum + value, 0) : null

  const provenance: string[] = []
  if (annualMeanTemperatureC !== null) {
    provenance.push(
      `Monthly climatology from ${input.monthly.length} months of ERA5 reanalysis for ${input.locationLabel}.`,
    )
  } else {
    provenance.push('No ERA5 record loaded; the model has no observed starting climatology.')
  }
  if (input.currentTemperatureC !== null) {
    provenance.push(`Current conditions observed at ${input.currentTemperatureC} °C.`)
  }
  if (input.meanIrradianceKwhPerM2Day !== null) {
    provenance.push(
      `NASA POWER mean irradiance ${input.meanIrradianceKwhPerM2Day.toFixed(2)} kWh/m²/day, shown for context.`,
    )
  }

  return {
    monthlyTemperatureC,
    monthlyPrecipitationMm,
    currentTemperatureC: input.currentTemperatureC,
    currentCloudCoverPercent: input.currentCloudCoverPercent,
    meanIrradianceKwhPerM2Day: input.meanIrradianceKwhPerM2Day,
    annualMeanTemperatureC,
    annualPrecipitationMm,
    locationLabel: input.locationLabel,
    provenance,
    seededFromObservation: annualMeanTemperatureC !== null || input.currentTemperatureC !== null,
  }
}
