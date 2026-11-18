/**
 * Climate engine: determinism, physics sanity and parameter response.
 *
 * These assert on physical relationships that must hold regardless of how the
 * model is tuned — more forcing gives more warming, transient stays below
 * equilibrium, identical inputs give identical output — rather than on
 * hard-coded numbers that would simply re-state the implementation.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildClimateBaseline, climateEngine, type ClimateBaseline } from '../src/simulation/engines/climate.ts'
import { runToCompletion } from '../src/simulation/types/engine.ts'
import { defaultValues, validate } from '../src/simulation/types/parameters.ts'
import { EQUILIBRIUM_SENSITIVITY, co2Forcing, CO2_PREINDUSTRIAL_PPM } from '../src/simulation/models/radiativeForcing.ts'

function baseline(): ClimateBaseline {
  // A synthetic but plausible mid-latitude climatology.
  const monthly = Array.from({ length: 12 }, (_, i) => ({
    month: `2024-${String(i + 1).padStart(2, '0')}`,
    temperatureMean: 10 + 12 * Math.sin(((i - 3) / 12) * 2 * Math.PI),
    precipitationSum: 60 + 20 * Math.cos((i / 12) * 2 * Math.PI),
  }))
  return buildClimateBaseline({
    monthly,
    currentTemperatureC: 14.2,
    currentCloudCoverPercent: 60,
    meanIrradianceKwhPerM2Day: 4.1,
    locationLabel: 'Test location',
  })
}

const defaults = defaultValues(climateEngine.parameters)

test('forcing follows the Myhre logarithmic fit', () => {
  assert.equal(co2Forcing(CO2_PREINDUSTRIAL_PPM), 0)
  // Doubling pre-industrial CO2 must give the conventional ~3.7 W/m2.
  const doubling = co2Forcing(CO2_PREINDUSTRIAL_PPM * 2)
  assert.ok(doubling > 3.6 && doubling < 3.8, `expected ~3.71, got ${doubling}`)
})

test('equilibrium sensitivity sits inside the IPCC AR6 likely range', () => {
  assert.ok(
    EQUILIBRIUM_SENSITIVITY > 2.5 && EQUILIBRIUM_SENSITIVITY < 4,
    `ECS ${EQUILIBRIUM_SENSITIVITY} outside 2.5-4 K`,
  )
})

test('identical parameters produce identical runs', () => {
  const b = baseline()
  const a = runToCompletion(climateEngine, defaults, b)
  const c = runToCompletion(climateEngine, defaults, b)
  assert.deepEqual(a.metrics, c.metrics)
  assert.equal(a.series.length, c.series.length)
  assert.deepEqual(a.series.at(-1), c.series.at(-1))
})

test('a higher CO2 pathway produces more warming', () => {
  const b = baseline()
  const flat = runToCompletion(climateEngine, { ...defaults, co2Pathway: 0 }, b)
  const trend = runToCompletion(climateEngine, { ...defaults, co2Pathway: 1 }, b)
  const high = runToCompletion(climateEngine, { ...defaults, co2Pathway: 2 }, b)

  assert.equal(flat.metrics.additionalWarmingK, 0, 'constant concentration gives no forcing anomaly')
  assert.ok(
    (trend.metrics.additionalWarmingK as number) > 0,
    'an increasing pathway must warm',
  )
  assert.ok(
    (high.metrics.additionalWarmingK as number) > (trend.metrics.additionalWarmingK as number),
    'a faster pathway must warm more',
  )
})

test('transient warming stays below the equilibrium commitment', () => {
  const b = baseline()
  const run = runToCompletion(climateEngine, { ...defaults, co2Pathway: 2 }, b)
  const transient = run.metrics.additionalWarmingK as number
  const committed = run.metrics.equilibriumWarmingK as number
  assert.ok(
    transient < committed,
    `transient ${transient} should lag equilibrium ${committed} because of ocean heat uptake`,
  )
})

test('increasing cloud cover cools and decreasing it warms', () => {
  const b = baseline()
  const cloudier = runToCompletion(climateEngine, { ...defaults, cloudCoverPercent: 80 }, b)
  const clearer = runToCompletion(climateEngine, { ...defaults, cloudCoverPercent: 40 }, b)
  assert.ok(
    (cloudier.metrics.forcingWm2 as number) < (clearer.metrics.forcingWm2 as number),
    'more cloud must give less forcing',
  )
  assert.ok(
    (cloudier.metrics.additionalWarmingK as number) < (clearer.metrics.additionalWarmingK as number),
  )
})

test('the precipitation lever scales the scenario total', () => {
  const b = baseline()
  const normal = runToCompletion(climateEngine, { ...defaults, precipitationScalePercent: 100, co2Pathway: 0 }, b)
  const dry = runToCompletion(climateEngine, { ...defaults, precipitationScalePercent: 50, co2Pathway: 0 }, b)
  const wet = runToCompletion(climateEngine, { ...defaults, precipitationScalePercent: 150, co2Pathway: 0 }, b)

  const n = normal.metrics.scenarioAnnualPrecipitation as number
  assert.ok(Math.abs((dry.metrics.scenarioAnnualPrecipitation as number) - n * 0.5) < 0.01)
  assert.ok(Math.abs((wet.metrics.scenarioAnnualPrecipitation as number) - n * 1.5) < 0.01)
})

test('warming raises precipitation through the hydrological sensitivity', () => {
  const b = baseline()
  const flat = runToCompletion(climateEngine, { ...defaults, co2Pathway: 0 }, b)
  const warming = runToCompletion(climateEngine, { ...defaults, co2Pathway: 2 }, b)
  assert.ok(
    (warming.metrics.scenarioAnnualPrecipitation as number) >
      (flat.metrics.scenarioAnnualPrecipitation as number),
    '2 %/K hydrological sensitivity must raise precipitation under warming',
  )
})

test('the starting anomaly offsets the scenario mean without changing the forcing', () => {
  const b = baseline()
  const zero = runToCompletion(climateEngine, { ...defaults, temperatureAnomalyK: 0 }, b)
  const offset = runToCompletion(climateEngine, { ...defaults, temperatureAnomalyK: 2 }, b)
  assert.equal(zero.metrics.forcingWm2, offset.metrics.forcingWm2)
  assert.ok(
    Math.abs(
      (offset.metrics.scenarioAnnualMeanTemperature as number) -
        (zero.metrics.scenarioAnnualMeanTemperature as number) -
        2,
    ) < 1e-9,
  )
})

test('observed values pass through untouched by the model', () => {
  const b = baseline()
  const run = runToCompletion(climateEngine, { ...defaults, temperatureAnomalyK: 4, co2Pathway: 2 }, b)
  assert.equal(run.metrics.observedCurrentTemperature, 14.2, 'the observation must not be modified')
  assert.equal(run.metrics.observedIrradiance, 4.1)
})

test('an empty baseline yields nulls rather than invented numbers', () => {
  const empty = buildClimateBaseline({
    monthly: [],
    currentTemperatureC: null,
    currentCloudCoverPercent: null,
    meanIrradianceKwhPerM2Day: null,
    locationLabel: 'Nowhere',
  })
  const run = runToCompletion(climateEngine, defaults, empty)
  assert.equal(run.metrics.baselineAnnualMeanTemperature, null)
  assert.equal(run.metrics.scenarioAnnualMeanTemperature, null)
  assert.equal(run.metrics.observedCurrentTemperature, null)
  assert.equal(empty.seededFromObservation, false)
})

test('parameter validation clamps out-of-range values and reports them', () => {
  const result = validate(climateEngine.parameters, { ...defaults, temperatureAnomalyK: 99 })
  assert.equal(result.values.temperatureAnomalyK, 6)
  assert.ok(result.issues.some((issue) => issue.key === 'temperatureAnomalyK'))
})

test('validation rejects an unknown CO2 pathway option', () => {
  const result = validate(climateEngine.parameters, { ...defaults, co2Pathway: 42 })
  assert.equal(result.values.co2Pathway, climateEngine.parameters.find((p) => p.key === 'co2Pathway')!.default)
  assert.ok(result.issues.some((issue) => issue.key === 'co2Pathway'))
})
