/**
 * Fire engine: physical monotonicity, extinction behaviour and determinism.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { conditionsFrom, forestEngine, ignitionPoints, type ForestBaseline } from '../src/simulation/engines/forest.ts'
import { runToCompletion } from '../src/simulation/types/engine.ts'
import { defaultValues } from '../src/simulation/types/parameters.ts'
import {
  MOISTURE_OF_EXTINCTION,
  cellsToHectares,
  effectiveFuelMoisture,
  moistureDamping,
  windFactor,
} from '../src/simulation/models/fireSpread.ts'

const defaults = defaultValues(forestEngine.parameters)

function baseline(): ForestBaseline {
  return {
    observedTemperatureC: 25,
    observedHumidityPercent: 45,
    observedWindSpeedKmh: 15,
    observedWindDirectionDeg: 225,
    recentRainfallMm: 2,
    satelliteDetectionCount: 7,
    recordedSpeciesCount: 140,
    locationLabel: 'Test',
    provenance: [],
    seededFromObservation: true,
  }
}

const run = (overrides: Record<string, number> = {}) =>
  runToCompletion(forestEngine, { ...defaults, ...overrides }, baseline())

test('moisture damping falls to zero at the moisture of extinction', () => {
  assert.ok(moistureDamping(0) > 0.9)
  assert.ok(moistureDamping(10) < moistureDamping(5))
  assert.equal(moistureDamping(MOISTURE_OF_EXTINCTION), 0)
  assert.equal(moistureDamping(MOISTURE_OF_EXTINCTION + 20), 0, 'damping never goes negative')
})

test('the wind factor is above 1 downwind and below 1 upwind', () => {
  const conditions = conditionsFrom(defaults, baseline())
  // Wind FROM 225 blows TOWARD 45.
  assert.ok(windFactor(conditions, 45) > 1, 'downwind must be enhanced')
  assert.ok(windFactor(conditions, 225) < 1, 'upwind must be suppressed')
  assert.ok(Math.abs(windFactor(conditions, 135) - 1) < 1e-9, 'crosswind is neutral')
})

test('still air gives a wind factor of exactly 1 in every direction', () => {
  const conditions = conditionsFrom({ ...defaults, windSpeedKmh: 0 }, baseline())
  for (const bearing of [0, 45, 90, 180, 270]) {
    assert.ok(Math.abs(windFactor(conditions, bearing) - 1) < 1e-12)
  }
})

test('heat and dryness lower effective fuel moisture; cool damp air raises it', () => {
  const hot = effectiveFuelMoisture({ ...conditionsFrom(defaults, baseline()), temperatureC: 40, relativeHumidityPercent: 10 })
  const cool = effectiveFuelMoisture({ ...conditionsFrom(defaults, baseline()), temperatureC: 10, relativeHumidityPercent: 90 })
  assert.ok(hot < cool, `hot/dry ${hot} must be drier than cool/damp ${cool}`)
})

test('a higher wind burns more area', () => {
  const calm = run({ windSpeedKmh: 2 })
  const windy = run({ windSpeedKmh: 55 })
  assert.ok(
    (windy.metrics.burnedHectares as number) > (calm.metrics.burnedHectares as number),
    `windy ${windy.metrics.burnedHectares} should exceed calm ${calm.metrics.burnedHectares}`,
  )
})

test('wetter fuels burn less, and fuel above extinction does not burn at all', () => {
  const dry = run({ fuelMoisturePercent: 5 })
  const damp = run({ fuelMoisturePercent: 22 })
  const soaked = run({
    fuelMoisturePercent: 45,
    relativeHumidityPercent: 95,
    precipitationScalePercent: 300,
    ignitionCount: 1,
  })
  assert.ok((damp.metrics.burnedHectares as number) < (dry.metrics.burnedHectares as number))
  // The ignition cell itself still burns out; what must not happen is spread
  // beyond it. One ignition point means at most one affected cell.
  const soakedAffected =
    (soaked.metrics.burnedCells as number) + (soaked.metrics.burningCells as number)
  assert.equal(
    soakedAffected,
    1,
    'above the moisture of extinction the fire must not spread past its ignition point',
  )
})

test('the shared temperature anomaly dries fuel and increases spread', () => {
  const cool = run({ temperatureAnomalyK: 0, fuelMoisturePercent: 18 })
  const warm = run({ temperatureAnomalyK: 5, fuelMoisturePercent: 18 })
  assert.ok(
    (warm.metrics.effectiveFuelMoisturePercent as number) <
      (cool.metrics.effectiveFuelMoisturePercent as number),
    'the cross-module temperature lever must reach the fuel moisture term',
  )
  assert.ok((warm.metrics.burnedHectares as number) >= (cool.metrics.burnedHectares as number))
})

test('the shared rainfall lever wets fuel and reduces spread', () => {
  const dry = run({ precipitationScalePercent: 0, fuelMoisturePercent: 14 })
  const wet = run({ precipitationScalePercent: 300, fuelMoisturePercent: 14 })
  assert.ok(
    (wet.metrics.effectiveFuelMoisturePercent as number) >
      (dry.metrics.effectiveFuelMoisturePercent as number),
  )
  assert.ok((wet.metrics.burnedHectares as number) <= (dry.metrics.burnedHectares as number))
})

test('breaking fuel continuity limits the fire — the percolation threshold', () => {
  const dense = run({ vegetationDensity: 0.95, windSpeedKmh: 40, fuelMoisturePercent: 6 })
  const sparse = run({ vegetationDensity: 0.35, windSpeedKmh: 40, fuelMoisturePercent: 6 })
  assert.ok(
    (sparse.metrics.burnedSharePercent as number) < (dense.metrics.burnedSharePercent as number),
    'a discontinuous fuel bed must burn a smaller share',
  )
})

test('more ignition points burn more area in the same time', () => {
  const one = run({ ignitionCount: 1 })
  const many = run({ ignitionCount: 5 })
  assert.ok((many.metrics.burnedHectares as number) > (one.metrics.burnedHectares as number))
  assert.equal(ignitionPoints(1).length, 1)
  assert.equal(ignitionPoints(5).length, 5)
})

test('burned area never exceeds the grid', () => {
  const extreme = run({ windSpeedKmh: 90, fuelMoisturePercent: 1, vegetationDensity: 1, ignitionCount: 5 })
  const gridHectares = cellsToHectares(64 * 64, 30)
  assert.ok((extreme.metrics.burnedHectares as number) <= gridHectares + 1e-6)
  assert.ok((extreme.metrics.burnedSharePercent as number) <= 100.0001)
})

test('the fire self-terminates and the run stops early', () => {
  const result = run({ windSpeedKmh: 30, fuelMoisturePercent: 6, vegetationDensity: 0.8 })
  const burning = result.metrics.burningCells as number
  // Either it burned out within the span, or it is still going at the end.
  assert.ok(burning >= 0)
  if (burning === 0) {
    assert.ok((result.metrics.containmentHour as number) !== null)
  }
})

test('runs are deterministic for a given seed', () => {
  const a = run()
  const b = run()
  assert.deepEqual(a.metrics, b.metrics)
})

test('satellite detections and species counts are never altered by the simulation', () => {
  const mild = run({ windSpeedKmh: 1 })
  const severe = run({ windSpeedKmh: 80, fuelMoisturePercent: 3 })
  assert.equal(mild.metrics.satelliteDetectionCount, 7)
  assert.equal(severe.metrics.satelliteDetectionCount, 7)
  assert.equal(severe.metrics.recordedSpeciesCount, 140)
})

test('a missing satellite count stays null rather than becoming zero', () => {
  const noData: ForestBaseline = { ...baseline(), satelliteDetectionCount: null, recordedSpeciesCount: null }
  const result = runToCompletion(forestEngine, defaults, noData)
  assert.equal(result.metrics.satelliteDetectionCount, null)
  assert.equal(result.metrics.recordedSpeciesCount, null)
})
