/**
 * Reservoir engine: mass balance, clipping behaviour and operational trade-offs.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { geometryFor, rainfallForDay, waterEngine, type WaterBaseline } from '../src/simulation/engines/water.ts'
import { runToCompletion } from '../src/simulation/types/engine.ts'
import { defaultValues } from '../src/simulation/types/parameters.ts'
import {
  catchmentRunoffMcm,
  evaporationRateMmPerDay,
  levelFromStorage,
  stepReservoir,
} from '../src/simulation/models/waterBalance.ts'

const defaults = defaultValues(waterEngine.parameters)

function baseline(rainfall: number[] = new Array(30).fill(5)): WaterBaseline {
  return {
    dailyRainfallMm: rainfall,
    forecastStartIndex: 7,
    meanTemperatureC: 20,
    glofasDischargeCumecs: 42.5,
    gaugeDischargeCumecs: 38.1,
    gaugeName: 'Test gauge',
    locationLabel: 'Test',
    provenance: [],
    seededFromObservation: true,
  }
}

const run = (overrides: Record<string, number> = {}, b = baseline()) =>
  runToCompletion(waterEngine, { ...defaults, ...overrides }, b)

test('runoff follows Q = C·P·A with correct unit conversion', () => {
  // 10 mm over 100 km2 at C=1 is 1 000 000 m3 = 1 Mm3.
  assert.ok(Math.abs(catchmentRunoffMcm(10, 100, 1) - 1) < 1e-9)
  assert.ok(Math.abs(catchmentRunoffMcm(10, 100, 0.5) - 0.5) < 1e-9)
  assert.equal(catchmentRunoffMcm(0, 100, 0.5), 0)
})

test('evaporation rises with temperature and never goes negative', () => {
  assert.ok(evaporationRateMmPerDay(30) > evaporationRateMmPerDay(20))
  assert.ok(evaporationRateMmPerDay(-100) >= 0)
})

test('the stage-storage relation is monotonic and bounded', () => {
  const geometry = geometryFor(250)
  assert.equal(levelFromStorage(0, geometry), 0)
  assert.ok(levelFromStorage(125, geometry) < levelFromStorage(250, geometry))
  assert.ok(Math.abs(levelFromStorage(250, geometry) - geometry.depthAtFullM) < 1e-9)
})

test('storage is clipped at capacity and the excess becomes spill', () => {
  const geometry = geometryFor(100)
  const result = stepReservoir(99, geometry, {
    rainfallMm: 500,
    catchmentAreaKm2: 1000,
    runoffCoefficient: 0.5,
    baseInflowCumecs: 0,
    releaseCumecs: 0,
    dailyDemandMcm: 0,
    distributionEfficiency: 1,
    temperatureC: 20,
    seepageFractionPerDay: 0,
  }, 1)
  assert.equal(result.storageMcm, 100, 'storage cannot exceed capacity')
  assert.ok(result.spilled)
  assert.ok(result.fluxes.spill > 0)
})

test('storage never goes negative; the shortfall is reported as unmet demand', () => {
  const geometry = geometryFor(100)
  const result = stepReservoir(1, geometry, {
    rainfallMm: 0,
    catchmentAreaKm2: 100,
    runoffCoefficient: 0.3,
    baseInflowCumecs: 0,
    releaseCumecs: 0,
    dailyDemandMcm: 10,
    distributionEfficiency: 1,
    temperatureC: 20,
    seepageFractionPerDay: 0,
  }, 1)
  assert.equal(result.storageMcm, 0)
  assert.ok(result.depleted)
  assert.ok(result.unmetDemandMcm > 0, 'the deficit must be reported, not absorbed')
})

test('more rainfall raises storage and eventually causes spill', () => {
  const dry = run({ precipitationScalePercent: 20 })
  const wet = run({ precipitationScalePercent: 300, initialFillPercent: 85 })
  assert.ok((wet.metrics.storageMcm as number) > (dry.metrics.storageMcm as number))
  assert.ok((wet.metrics.spillDays as number) > 0, 'an extreme scenario against a full reservoir must spill')
  assert.equal(dry.metrics.spillDays, 0)
})

test('pre-releasing trades spill against stored water — a genuine trade-off', () => {
  const noPreRelease = run({ precipitationScalePercent: 300, initialFillPercent: 85, releaseCumecs: 12 })
  const preRelease = run({ precipitationScalePercent: 300, initialFillPercent: 60, releaseCumecs: 45 })
  assert.ok(
    (preRelease.metrics.totalSpillMcm as number) < (noPreRelease.metrics.totalSpillMcm as number),
    'creating headroom must reduce spill',
  )
  assert.ok(
    (preRelease.metrics.storageMcm as number) < (noPreRelease.metrics.storageMcm as number),
    'and must leave less water in store — that is the cost',
  )
})

test('warming raises evaporation loss without touching inflow', () => {
  const cool = run({ temperatureAnomalyK: 0 })
  const warm = run({ temperatureAnomalyK: 5 })
  assert.ok((warm.metrics.totalEvaporationMcm as number) > (cool.metrics.totalEvaporationMcm as number))
  assert.ok(
    Math.abs((warm.metrics.totalInflowMcm as number) - (cool.metrics.totalInflowMcm as number)) < 1e-9,
    'the temperature lever must not alter inflow',
  )
})

test('reducing leakage cuts abstraction under drought', () => {
  const leaky = run({ precipitationScalePercent: 30, distributionEfficiencyPercent: 60, initialFillPercent: 55 })
  const tight = run({ precipitationScalePercent: 30, distributionEfficiencyPercent: 95, initialFillPercent: 55 })
  assert.ok(
    (tight.metrics.storageMcm as number) > (leaky.metrics.storageMcm as number),
    'delivering the same service with less leakage must leave more water in store',
  )
  assert.ok((tight.metrics.leakageMcm as number) < (leaky.metrics.leakageMcm as number))
})

test('capacity utilisation stays within 0-100', () => {
  for (const scale of [0, 100, 400]) {
    for (const fill of [0, 50, 100]) {
      const result = run({ precipitationScalePercent: scale, initialFillPercent: fill })
      const percent = result.metrics.fillPercent as number
      assert.ok(percent >= 0 && percent <= 100.0001, `fill ${percent} out of range`)
    }
  }
})

test('observed data passes through untouched by the model', () => {
  const result = run({ precipitationScalePercent: 300, temperatureAnomalyK: 5 })
  assert.equal(result.metrics.glofasDischargeCumecs, 42.5)
  assert.equal(result.metrics.gaugeDischargeCumecs, 38.1)
})

test('an empty rainfall series gives zero rainfall rather than a guess', () => {
  const empty: WaterBaseline = { ...baseline([]), seededFromObservation: false }
  assert.equal(rainfallForDay(empty, 0, 100), 0)
  const result = run({}, empty)
  assert.equal(result.metrics.observedRainfallMm, null, 'no series means no total, not a zero')
})

test('runs are deterministic', () => {
  const a = run()
  const b = run()
  assert.deepEqual(a.metrics, b.metrics)
})

test('the rainfall lever scales the series linearly', () => {
  const b = baseline(new Array(30).fill(10))
  assert.equal(rainfallForDay(b, 0, 100), 10)
  assert.equal(rainfallForDay(b, 0, 50), 5)
  assert.equal(rainfallForDay(b, 0, 250), 25)
})
