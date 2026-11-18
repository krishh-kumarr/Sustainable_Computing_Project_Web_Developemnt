/**
 * Data centre engine: PUE identity, thermal feedback and supply accounting.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  THERMAL_THROTTLE_C,
  dataCentreEngine,
  effectiveOverhead,
  serverPowerWatts,
  throttleFactor,
  workloadAt,
  type DataCentreBaseline,
} from '../src/simulation/engines/datacentre.ts'
import { runToCompletion } from '../src/simulation/types/engine.ts'
import { defaultValues } from '../src/simulation/types/parameters.ts'
import { compareRuns } from '../src/simulation/scenarios/compare.ts'

const defaults = defaultValues(dataCentreEngine.parameters)

function baseline(outdoorTemperatureC: number | null = null): DataCentreBaseline {
  return {
    outdoorTemperatureC,
    locationLabel: 'Test',
    provenance: [],
    seededFromObservation: outdoorTemperatureC !== null,
  }
}

test('server power interpolates between idle and rated', () => {
  assert.equal(serverPowerWatts(400, 0.5, 0), 200)
  assert.equal(serverPowerWatts(400, 0.5, 100), 400)
  assert.equal(serverPowerWatts(400, 0.5, 50), 300)
})

test('the workload profile peaks at 15:00 and troughs at 03:00', () => {
  const peak = workloadAt(15, 50, 20)
  const trough = workloadAt(3, 50, 20)
  assert.ok(Math.abs(peak - 70) < 0.001, `expected 70 at 15:00, got ${peak}`)
  assert.ok(Math.abs(trough - 30) < 0.001, `expected 30 at 03:00, got ${trough}`)
})

test('workload stays within 0-100 even with an extreme swing', () => {
  for (let hour = 0; hour < 48; hour++) {
    const value = workloadAt(hour, 10, 50)
    assert.ok(value >= 0 && value <= 100, `hour ${hour} gave ${value}`)
  }
})

test('PUE equals total energy divided by IT energy', () => {
  const run = runToCompletion(dataCentreEngine, defaults, baseline())
  const pue = run.metrics.pue as number
  const total = run.metrics.totalEnergyMwh as number
  const it = run.metrics.itEnergyMwh as number
  assert.ok(Math.abs(pue - total / it) < 1e-9, 'PUE must be the stated identity, not an approximation')
  assert.ok(pue > 1, 'PUE below 1 would mean the facility produces energy')
})

test('a lower cooling overhead gives a lower PUE and less energy', () => {
  const inefficient = runToCompletion(dataCentreEngine, { ...defaults, coolingOverheadFraction: 0.9 }, baseline())
  const efficient = runToCompletion(dataCentreEngine, { ...defaults, coolingOverheadFraction: 0.2 }, baseline())
  assert.ok((efficient.metrics.pue as number) < (inefficient.metrics.pue as number))
  assert.ok((efficient.metrics.totalEnergyMwh as number) < (inefficient.metrics.totalEnergyMwh as number))
})

test('renewable share changes emissions but never energy', () => {
  const dirty = runToCompletion(dataCentreEngine, { ...defaults, renewableSharePercent: 0 }, baseline())
  const clean = runToCompletion(dataCentreEngine, { ...defaults, renewableSharePercent: 90 }, baseline())
  assert.ok(
    Math.abs((dirty.metrics.totalEnergyMwh as number) - (clean.metrics.totalEnergyMwh as number)) < 1e-9,
    'switching supply must not alter how much electricity is used',
  )
  assert.ok((clean.metrics.emissionsTonnes as number) < (dirty.metrics.emissionsTonnes as number))
  // 90% renewable against 0% must cut emissions by exactly 90%.
  const ratio = (clean.metrics.emissionsTonnes as number) / (dirty.metrics.emissionsTonnes as number)
  assert.ok(Math.abs(ratio - 0.1) < 1e-6, `expected a 90% cut, got ratio ${ratio}`)
})

test('zero grid carbon intensity gives zero emissions', () => {
  const run = runToCompletion(dataCentreEngine, { ...defaults, gridCarbonIntensity: 10, renewableSharePercent: 100 }, baseline())
  assert.equal(run.metrics.emissionsTonnes, 0)
})

test('throttling engages above the thermal limit and not below it', () => {
  assert.equal(throttleFactor(THERMAL_THROTTLE_C - 1), 1)
  assert.equal(throttleFactor(THERMAL_THROTTLE_C), 1)
  assert.ok(throttleFactor(THERMAL_THROTTLE_C + 4) < 1)
  assert.ok(throttleFactor(100) >= 0.1, 'throttling floors at 10%, never negative')
})

test('under-provisioned cooling causes throttling and lost work', () => {
  const adequate = runToCompletion(
    dataCentreEngine,
    { ...defaults, coolingCapacityRatio: 1.3, baseUtilisationPercent: 80 },
    baseline(),
  )
  const starved = runToCompletion(
    dataCentreEngine,
    { ...defaults, coolingCapacityRatio: 0.6, baseUtilisationPercent: 80 },
    baseline(),
  )
  assert.equal(adequate.metrics.throttledHours, 0, 'adequate cooling must never throttle')
  assert.ok((starved.metrics.throttledHours as number) > 0, 'starved cooling must throttle')
  assert.ok(
    (starved.metrics.workUnits as number) < (adequate.metrics.workUnits as number),
    'throttling must cost useful work',
  )
  assert.ok(
    (starved.metrics.hallTemperatureC as number) > (adequate.metrics.hallTemperatureC as number),
  )
})

test('free cooling only applies when outside air is below setpoint', () => {
  assert.equal(effectiveOverhead(0.5, null, 24), 0.5, 'no observation means no benefit claimed')
  assert.equal(effectiveOverhead(0.5, 30, 24), 0.5, 'warm outside air gives no benefit')
  assert.ok(effectiveOverhead(0.5, 5, 24) < 0.5, 'cold outside air must reduce overhead')
  assert.ok(effectiveOverhead(0.5, -40, 24) >= 0.5 * 0.4, 'the benefit is capped at 60%')
})

test('cold outside air lowers facility energy through free cooling', () => {
  const warm = runToCompletion(dataCentreEngine, defaults, baseline(30))
  const cold = runToCompletion(dataCentreEngine, defaults, baseline(2))
  assert.ok((cold.metrics.totalEnergyMwh as number) < (warm.metrics.totalEnergyMwh as number))
  assert.ok(
    Math.abs((cold.metrics.itEnergyMwh as number) - (warm.metrics.itEnergyMwh as number)) < 1e-9,
    'free cooling must not change IT energy',
  )
})

test('consolidation improves energy per unit of work', () => {
  const sprawl = runToCompletion(
    dataCentreEngine,
    { ...defaults, serverCount: 500, baseUtilisationPercent: 20, diurnalSwingPercent: 0 },
    baseline(),
  )
  const consolidated = runToCompletion(
    dataCentreEngine,
    { ...defaults, serverCount: 150, baseUtilisationPercent: 67, diurnalSwingPercent: 0 },
    baseline(),
  )
  assert.ok(
    (consolidated.metrics.energyPerWorkUnit as number) < (sprawl.metrics.energyPerWorkUnit as number),
    'running fewer servers harder must deliver work more cheaply',
  )
})

test('runs are deterministic', () => {
  const a = runToCompletion(dataCentreEngine, defaults, baseline(12))
  const b = runToCompletion(dataCentreEngine, defaults, baseline(12))
  assert.deepEqual(a.metrics, b.metrics)
})

test('comparison reports a trade-off rather than a verdict', () => {
  // Raising the setpoint saves energy but runs the hall hotter: a genuine
  // trade-off, and the comparison must name it as one.
  const cool = runToCompletion(
    dataCentreEngine,
    { ...defaults, coolingSetpointC: 18, baseUtilisationPercent: 60 },
    baseline(),
    { kind: 'baseline', label: 'Baseline' },
  )
  const warm = runToCompletion(
    dataCentreEngine,
    { ...defaults, coolingSetpointC: 30, baseUtilisationPercent: 60 },
    baseline(),
    { kind: 'alternative', label: 'Alternative' },
  )
  const comparison = compareRuns(dataCentreEngine.metrics, dataCentreEngine.parameters, cool, warm)
  assert.ok(comparison.parameterDeltas.some((delta) => delta.spec.key === 'coolingSetpointC'))
  assert.ok(comparison.improved.length > 0 || comparison.worsened.length > 0)
  assert.equal(comparison.isIdentical, false)
})

test('an unchanged parameter set compares as identical', () => {
  const a = runToCompletion(dataCentreEngine, defaults, baseline(), { kind: 'baseline' })
  const b = runToCompletion(dataCentreEngine, defaults, baseline(), { kind: 'alternative' })
  const comparison = compareRuns(dataCentreEngine.metrics, dataCentreEngine.parameters, a, b)
  assert.equal(comparison.isIdentical, true)
  assert.equal(comparison.parameterDeltas.length, 0)
})

test('the outdoor observation passes through unmodified', () => {
  const run = runToCompletion(dataCentreEngine, defaults, baseline(17.3))
  assert.equal(run.metrics.outdoorTemperatureC, 17.3)
})
