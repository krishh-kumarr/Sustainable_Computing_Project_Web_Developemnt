/**
 * Fire propagation engine.
 *
 * Wraps the grid cellular automaton in `models/fireSpread.ts` with observed
 * fire-weather conditions as its starting point. The simulated fire and the
 * real NASA FIRMS satellite detections are kept entirely separate: detections
 * are measurements of thermal anomalies that happened, the simulation is a
 * teaching model of how a hypothetical fire would spread under the conditions
 * you set.
 *
 * Nothing here is an operational prediction. See FIRE_MODEL_DISCLAIMER.
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
  BURNED,
  BURNING,
  FIRE_MODEL_DISCLAIMER,
  MOISTURE_OF_EXTINCTION,
  cellsToHectares,
  createGrid,
  effectiveFuelMoisture,
  igniteAt,
  moistureDamping,
  rateOfSpread,
  stepFire,
  windFactor,
  type FireConditions,
  type FireGrid,
} from '../models/fireSpread.ts'

/** Grid dimensions, fixed so the 3D scene and the model agree exactly. */
export const GRID_WIDTH = 64
export const GRID_HEIGHT = 64
/** Each cell is 30 m — comparable to a Landsat pixel. */
export const CELL_SIZE_M = 30

export interface ForestBaseline extends EngineBaseline {
  observedTemperatureC: number | null
  observedHumidityPercent: number | null
  observedWindSpeedKmh: number | null
  observedWindDirectionDeg: number | null
  /** Rainfall over the past week, mm. Raises fuel moisture. */
  recentRainfallMm: number | null
  /** NASA FIRMS detections in the area. Reported, never simulated. */
  satelliteDetectionCount: number | null
  /** Distinct GBIF species recorded nearby. Reported, never simulated. */
  recordedSpeciesCount: number | null
  locationLabel: string
}

export const EMPTY_FOREST_BASELINE: ForestBaseline = {
  observedTemperatureC: null,
  observedHumidityPercent: null,
  observedWindSpeedKmh: null,
  observedWindDirectionDeg: null,
  recentRainfallMm: null,
  satelliteDetectionCount: null,
  recordedSpeciesCount: null,
  locationLabel: 'No location',
  provenance: ['No observed fire weather loaded yet.'],
  seededFromObservation: false,
}

export interface ForestState {
  hours: number
  grid: FireGrid
  burningCells: number
  burnedCells: number
  unburnedFuelCells: number
  /** Fuel cells present at ignition, for the "share burned" metric. */
  initialFuelCells: number
  peakBurningCells: number
  /** Hour at which the last cell ignited, i.e. when the fire stopped growing. */
  lastIgnitionHour: number
  extinguished: boolean
}

const PARAMETERS: ParameterSpec[] = [
  {
    key: 'temperatureC',
    label: 'Air temperature',
    unit: '°C',
    min: -5,
    max: 50,
    step: 0.5,
    default: 25,
    decimals: 1,
    group: 'Weather',
    seededFromObservation: true,
    note: 'Seeded from the observed temperature at this location. Warmer air dries fine fuels, which is how the shared temperature lever reaches this model.',
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
    group: 'Weather',
    sharedKey: 'temperatureAnomalyK',
    note: 'Added to the temperature above. Shared with Climate, AquaGuard and AgriFuture.',
  },
  {
    key: 'relativeHumidityPercent',
    label: 'Relative humidity',
    unit: '%',
    min: 5,
    max: 100,
    step: 1,
    default: 45,
    decimals: 0,
    group: 'Weather',
    seededFromObservation: true,
    note: 'Seeded from the observed humidity. Dry air draws moisture out of fine fuels within hours.',
  },
  {
    key: 'windSpeedKmh',
    label: 'Wind speed',
    unit: 'km/h',
    min: 0,
    max: 90,
    step: 1,
    default: 15,
    decimals: 0,
    group: 'Weather',
    seededFromObservation: true,
    note: 'Seeded from the observed wind. The single strongest control on spread rate: the wind factor is exponential in speed.',
  },
  {
    key: 'windDirectionDeg',
    label: 'Wind direction',
    unit: '°',
    min: 0,
    max: 359,
    step: 5,
    default: 225,
    decimals: 0,
    group: 'Weather',
    seededFromObservation: true,
    note: 'Meteorological convention: the direction the wind blows FROM. Seeded from the observation.',
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
    group: 'Weather',
    sharedKey: 'precipitationScalePercent',
    note: 'Scales recent observed rainfall, which raises fuel moisture. Shared with Climate, AquaGuard and AgriFuture.',
  },
  {
    key: 'fuelMoisturePercent',
    label: 'Base fine-fuel moisture',
    unit: '%',
    min: 1,
    max: 45,
    step: 1,
    default: 12,
    decimals: 0,
    group: 'Fuel',
    note: `Moisture content of fine dead fuels before the temperature, humidity and rainfall adjustments. Above the ${MOISTURE_OF_EXTINCTION}% moisture of extinction, fine fuels will not carry a fire at all.`,
  },
  {
    key: 'vegetationDensity',
    label: 'Vegetation density',
    unit: 'fraction of cells',
    min: 0.2,
    max: 1,
    step: 0.01,
    default: 0.72,
    decimals: 2,
    group: 'Fuel',
    note: 'Share of grid cells carrying fuel. Below roughly 0.6 the fuel bed stops being continuous and fires self-extinguish on the gaps — the percolation threshold.',
  },
  {
    key: 'ignitionCount',
    label: 'Ignition points',
    unit: 'points',
    min: 1,
    max: 5,
    step: 1,
    default: 1,
    decimals: 0,
    group: 'Ignition',
    note: 'Number of simultaneous ignitions, placed deterministically. Multiple ignitions merge into a larger perimeter faster than one.',
  },
  {
    key: 'seed',
    label: 'Fuel-field seed',
    unit: '',
    min: 1,
    max: 9999,
    step: 1,
    default: 4242,
    decimals: 0,
    group: 'Ignition',
    note: 'Seeds the deterministic fuel field. The same seed and density always generate exactly the same forest.',
  },
]

const METRICS: MetricDefinition[] = [
  { key: 'burnedHectares', label: 'Area burned', unit: 'ha', kind: 'illustrative', decimals: 1, headline: true, lowerIsBetter: true },
  { key: 'burnedCells', label: 'Cells burned', unit: 'cells', kind: 'illustrative', decimals: 0, lowerIsBetter: true },
  { key: 'burningCells', label: 'Cells actively burning', unit: 'cells', kind: 'illustrative', decimals: 0 },
  { key: 'burnedSharePercent', label: 'Share of fuel consumed', unit: '%', kind: 'illustrative', decimals: 1, headline: true, lowerIsBetter: true },
  { key: 'spreadRateMPerHour', label: 'Head-fire spread rate', unit: 'm/h', kind: 'illustrative', decimals: 0, headline: true, lowerIsBetter: true, note: 'Rate of spread directly downwind at the current conditions. The flanks and back of the fire move far more slowly.' },
  { key: 'effectiveFuelMoisturePercent', label: 'Effective fuel moisture', unit: '%', kind: 'illustrative', decimals: 1, headline: true, note: 'Base moisture after adjusting for temperature, humidity and recent rainfall. This is what the spread model actually uses.' },
  { key: 'moistureDampingFactor', label: 'Moisture damping', unit: '', kind: 'illustrative', decimals: 3, note: 'Multiplier on spread rate. Reaches zero at the moisture of extinction, where fire cannot carry.' },
  { key: 'windFactorDownwind', label: 'Wind factor downwind', unit: '×', kind: 'illustrative', decimals: 2, note: 'Exponential in wind speed. Doubling the wind more than doubles the downwind spread rate.' },
  { key: 'containmentHour', label: 'Growth ceased at', unit: 'h', kind: 'illustrative', decimals: 1, note: 'Simulated hour of the last new ignition. The fire stopped growing after this, having run out of reachable fuel.' },
  { key: 'satelliteDetectionCount', label: 'Satellite fire detections', unit: 'detections', kind: 'satellite', decimals: 0, sourceId: 'nasa-firms', note: 'Real NASA FIRMS thermal anomalies in this area. Measurements of fires that happened — entirely separate from the simulation above.' },
  { key: 'recordedSpeciesCount', label: 'Species recorded nearby', unit: 'species', kind: 'observation', decimals: 0, sourceId: 'gbif', note: 'Distinct scientific names in the retrieved GBIF page. Survey effort, not a census, and not affected by the simulation.' },
  { key: 'observedTemperatureC', label: 'Observed temperature', unit: '°C', kind: 'observation', decimals: 1, sourceId: 'open-meteo-forecast' },
  { key: 'observedHumidityPercent', label: 'Observed humidity', unit: '%', kind: 'observation', decimals: 0, sourceId: 'open-meteo-forecast' },
]

const SERIES: SeriesKey[] = [
  { key: 'burnedHectares', label: 'Area burned', unit: 'ha', colour: '#D97706' },
  { key: 'burning', label: 'Cells burning', unit: 'cells', colour: '#E8502A' },
  { key: 'burned', label: 'Cells burned out', unit: 'cells', colour: '#6E6A60' },
  { key: 'remainingFuel', label: 'Cells with fuel left', unit: 'cells', colour: '#64816C' },
]

const PRESETS: ScenarioPreset[] = [
  {
    id: 'observed-conditions',
    label: 'Observed conditions',
    kind: 'baseline',
    description: 'Fire weather as currently observed at this location, with a single ignition.',
    overrides: { temperatureAnomalyK: 0, precipitationScalePercent: 100, ignitionCount: 1, vegetationDensity: 0.72, fuelMoisturePercent: 12 },
  },
  {
    id: 'high-wind',
    label: 'High wind',
    kind: 'alternative',
    description: 'The same fuels and moisture, with wind at 55 km/h. Spread is exponential in wind speed, so the difference is dramatic.',
    overrides: { windSpeedKmh: 55, temperatureAnomalyK: 0, precipitationScalePercent: 100, ignitionCount: 1 },
  },
  {
    id: 'hot-dry',
    label: 'Hot, dry and windy',
    kind: 'alternative',
    description: 'The classic dangerous combination: +4 K, 12 % humidity, 45 km/h wind and a third of normal rainfall.',
    overrides: { temperatureAnomalyK: 4, relativeHumidityPercent: 12, windSpeedKmh: 45, precipitationScalePercent: 30, fuelMoisturePercent: 7 },
  },
  {
    id: 'fuel-break',
    label: 'Reduced fuel continuity',
    kind: 'optimised',
    description: 'Vegetation density cut to 0.5 by thinning and fuel breaks, under the same hot, dry, windy weather. Tests whether breaking continuity beats fighting the weather.',
    overrides: { temperatureAnomalyK: 4, relativeHumidityPercent: 12, windSpeedKmh: 45, precipitationScalePercent: 30, fuelMoisturePercent: 7, vegetationDensity: 0.5 },
  },
  {
    id: 'after-rain',
    label: 'After heavy rain',
    kind: 'alternative',
    description: 'Three times normal rainfall has wetted the fuels. Shows the moisture of extinction stopping ignition entirely.',
    overrides: { precipitationScalePercent: 300, relativeHumidityPercent: 85, fuelMoisturePercent: 28, windSpeedKmh: 10 },
  },
]

/**
 * Fuel moisture after recent rainfall.
 *
 * Fine dead fuels respond to rain within hours. A linear uptake term capped at
 * the moisture of extinction is a teaching approximation of the published fine
 * fuel moisture models, not a fit to them.
 */
export const MOISTURE_PER_MM_RAIN = 0.9

export function conditionsFrom(params: Record<string, number>, baseline: ForestBaseline): FireConditions {
  const rainfallMm = (baseline.recentRainfallMm ?? 0) * (params.precipitationScalePercent / 100)
  const rainUptake = Math.min(rainfallMm * MOISTURE_PER_MM_RAIN, 25)
  return {
    temperatureC: params.temperatureC + params.temperatureAnomalyK,
    relativeHumidityPercent: params.relativeHumidityPercent,
    windSpeedKmh: params.windSpeedKmh,
    windDirectionDeg: params.windDirectionDeg,
    vegetationDensity: params.vegetationDensity,
    fuelMoisturePercent: params.fuelMoisturePercent + rainUptake,
  }
}

/** Deterministic ignition points, spread across the upwind side of the grid. */
export function ignitionPoints(count: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [{ x: GRID_WIDTH >> 1, y: GRID_HEIGHT >> 1 }]
  const offsets = [
    { x: -12, y: -8 },
    { x: 11, y: 9 },
    { x: -9, y: 12 },
    { x: 13, y: -11 },
  ]
  for (let i = 0; i < Math.min(count - 1, offsets.length); i++) {
    points.push({
      x: (GRID_WIDTH >> 1) + offsets[i].x,
      y: (GRID_HEIGHT >> 1) + offsets[i].y,
    })
  }
  return points
}

export const forestEngine: SimulationEngine<ForestState, ForestBaseline> = {
  id: 'forest',
  label: 'Fire propagation engine',
  tickHours: 0.25,
  defaultDurationHours: 12,
  timeUnit: 'hours',
  parameters: PARAMETERS,
  metrics: METRICS,
  series: SERIES,
  presets: PRESETS,
  disclaimer: FIRE_MODEL_DISCLAIMER,
  assumptions: [
    'The grid is 64 × 64 cells of 30 m, covering 3.7 km². Terrain is flat: there is no slope term, and slope is one of the strongest real controls on spread.',
    'Rate of spread borrows the Rothermel functional form — base rate × wind × moisture × fuel — without its physics. There is no reaction intensity, fuel-bed depth, packing ratio or heat of pre-ignition.',
    'The wind factor is exponential in speed with a directional cosine. This reproduces the elliptical fire shape without solving for it.',
    `Fine fuels will not carry fire above the ${MOISTURE_OF_EXTINCTION}% moisture of extinction, a conventional value for grass and light surface fuels.`,
    'Rainfall raises fuel moisture by 0.9 percentage points per millimetre, capped at 25. A teaching approximation of fine fuel moisture response.',
    'There is no crown fire, no spotting from embers, no firefighting and no fire-atmosphere coupling.',
    'The fuel field comes from a seeded generator, so the same seed and density always produce the same forest.',
    'NASA FIRMS detections shown alongside are real satellite measurements and are never mixed into this simulation.',
  ],

  init(params) {
    const grid = createGrid(
      GRID_WIDTH,
      GRID_HEIGHT,
      CELL_SIZE_M,
      params.vegetationDensity,
      Math.floor(params.seed) >>> 0,
    )
    let initialFuelCells = 0
    for (let i = 0; i < grid.fuel.length; i++) if (grid.fuel[i] > 0) initialFuelCells++

    for (const point of ignitionPoints(params.ignitionCount)) igniteAt(grid, point.x, point.y)

    let burningCells = 0
    for (let i = 0; i < grid.state.length; i++) if (grid.state[i] === BURNING) burningCells++

    return {
      hours: 0,
      grid,
      burningCells,
      burnedCells: 0,
      unburnedFuelCells: initialFuelCells - burningCells,
      initialFuelCells,
      peakBurningCells: burningCells,
      lastIgnitionHour: 0,
      extinguished: burningCells === 0,
    }
  },

  step(state, params, baseline, tickHours) {
    if (state.burningCells === 0) {
      return { ...state, hours: state.hours + tickHours, extinguished: true }
    }
    const conditions = conditionsFrom(params, baseline)
    const result = stepFire(state.grid, conditions, tickHours)
    const hours = state.hours + tickHours

    return {
      hours,
      grid: result.grid,
      burningCells: result.burningCount,
      burnedCells: result.burnedCount,
      unburnedFuelCells: result.unburnedFuelCount,
      initialFuelCells: state.initialFuelCells,
      peakBurningCells: Math.max(state.peakBurningCells, result.burningCount),
      lastIgnitionHour: result.newlyIgnited > 0 ? hours : state.lastIgnitionHour,
      extinguished: result.burningCount === 0,
    }
  },

  derive(state, params, baseline) {
    const conditions = conditionsFrom(params, baseline)
    const effectiveMoisture = effectiveFuelMoisture(conditions)
    const affected = state.burnedCells + state.burningCells
    // Spread rate directly downwind, at full fuel load.
    const downwindBearing = (conditions.windDirectionDeg + 180) % 360

    return {
      burnedHectares: cellsToHectares(affected, CELL_SIZE_M),
      burnedCells: state.burnedCells,
      burningCells: state.burningCells,
      burnedSharePercent:
        state.initialFuelCells > 0 ? (affected / state.initialFuelCells) * 100 : null,
      spreadRateMPerHour: rateOfSpread(conditions, downwindBearing, 1),
      effectiveFuelMoisturePercent: effectiveMoisture,
      moistureDampingFactor: moistureDamping(effectiveMoisture),
      windFactorDownwind: windFactor(conditions, downwindBearing),
      containmentHour: state.extinguished ? state.lastIgnitionHour : null,
      satelliteDetectionCount: baseline.satelliteDetectionCount,
      recordedSpeciesCount: baseline.recordedSpeciesCount,
      observedTemperatureC: baseline.observedTemperatureC,
      observedHumidityPercent: baseline.observedHumidityPercent,
    }
  },

  sample(state) {
    return {
      t: Number(state.hours.toFixed(2)),
      burnedHectares: Number(
        cellsToHectares(state.burnedCells + state.burningCells, CELL_SIZE_M).toFixed(2),
      ),
      burning: state.burningCells,
      burned: state.burnedCells,
      remainingFuel: state.unburnedFuelCells,
    } satisfies SeriesRow
  },

  explain(state, params, baseline) {
    const conditions = conditionsFrom(params, baseline)
    const effectiveMoisture = effectiveFuelMoisture(conditions)
    const downwindBearing = (conditions.windDirectionDeg + 180) % 360
    const rainfallMm = (baseline.recentRainfallMm ?? 0) * (params.precipitationScalePercent / 100)
    const r = (value: number, decimals = 2) => value.toFixed(decimals)

    return [
      `Temperature = ${r(params.temperatureC, 1)} °C observed + ${r(params.temperatureAnomalyK, 1)} K anomaly = ${r(conditions.temperatureC, 1)} °C`,
      `Fuel moisture = ${params.fuelMoisturePercent}% base + ${r(Math.min(rainfallMm * MOISTURE_PER_MM_RAIN, 25), 1)} from ${r(rainfallMm, 1)} mm recent rain = ${r(conditions.fuelMoisturePercent, 1)}%`,
      `Adjusted for ${r(conditions.temperatureC, 1)} °C and ${params.relativeHumidityPercent}% humidity → effective moisture ${r(effectiveMoisture, 1)}%`,
      `Moisture damping = ${r(moistureDamping(effectiveMoisture), 3)} (zero at the ${MOISTURE_OF_EXTINCTION}% moisture of extinction)`,
      `Wind factor downwind = exp(0.09 × ${params.windSpeedKmh} km/h × 1) = ${r(windFactor(conditions, downwindBearing), 2)}×`,
      `Head-fire rate of spread = 40 m/h base × ${r(windFactor(conditions, downwindBearing), 2)} wind × ${r(moistureDamping(effectiveMoisture), 3)} moisture = ${r(rateOfSpread(conditions, downwindBearing, 1), 0)} m/h`,
      `Grid: ${GRID_WIDTH}×${GRID_HEIGHT} cells of ${CELL_SIZE_M} m = ${r(cellsToHectares(GRID_WIDTH * GRID_HEIGHT, CELL_SIZE_M), 0)} ha total, ${state.initialFuelCells} cells with fuel at ${r(params.vegetationDensity, 2)} density`,
      `After ${r(state.hours, 2)} h: ${state.burningCells} burning, ${state.burnedCells} burned out, ${r(cellsToHectares(state.burnedCells + state.burningCells, CELL_SIZE_M), 1)} ha affected`,
      state.extinguished
        ? `The fire has gone out. It stopped growing at hour ${r(state.lastIgnitionHour, 2)}, having run out of reachable fuel.`
        : 'The fire is still spreading.',
    ]
  },

  elapsedHours(state) {
    return state.hours
  },

  isComplete(state) {
    // No point continuing to integrate an extinguished fire.
    return state.extinguished && state.hours > 0
  },
}

export { BURNED, BURNING, FIRE_MODEL_DISCLAIMER }
