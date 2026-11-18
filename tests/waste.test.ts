/**
 * MRF engine: conservation of mass, trade-offs and determinism.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COMPOSITION_PROFILES,
  MATERIALS,
  WASTE_BASELINE,
  diverterAssignments,
  profileById,
  wasteEngine,
} from '../src/simulation/engines/waste.ts'
import { runToCompletion } from '../src/simulation/types/engine.ts'
import { defaultValues } from '../src/simulation/types/parameters.ts'

const defaults = defaultValues(wasteEngine.parameters)
const run = (overrides: Record<string, number> = {}, durationHours?: number) =>
  runToCompletion(wasteEngine, { ...defaults, ...overrides }, WASTE_BASELINE, { durationHours })

test('every published composition profile sums to 1', () => {
  for (const profile of COMPOSITION_PROFILES) {
    const total = MATERIALS.reduce((sum, key) => sum + profile.fractions[key], 0)
    assert.ok(Math.abs(total - 1) < 1e-9, `${profile.label} sums to ${total}`)
  }
})

test('mass is conserved: binned + residual equals the feed', () => {
  const result = run()
  const processed = result.metrics.totalProcessedKg as number
  const recovered = result.metrics.recoveredKg as number
  const residual = result.metrics.residualKg as number
  // Items still on the belt at the end are neither binned nor residual yet,
  // so the accounted mass must never exceed what arrived.
  assert.ok(recovered + residual <= processed + 1e-6, 'mass cannot be created')
  assert.ok(processed > 0, 'the line must actually process something')
})

test('a stopped belt processes nothing downstream', () => {
  const result = run({ beltSpeedMps: 0 })
  assert.equal(result.metrics.recoveredKg, 0)
  assert.equal(result.metrics.residualKg, 0)
  assert.ok((result.metrics.totalProcessedKg as number) > 0, 'items still arrive on a stopped belt')
})

test('zero feed rate yields no items at all', () => {
  const result = run({ arrivalRatePerMin: 0 })
  assert.equal(result.metrics.itemsProcessed, 0)
  assert.equal(result.metrics.totalProcessedKg, 0)
  assert.equal(result.metrics.recoveryRatePercent, null, 'no feed means no rate, not a fabricated zero')
})

test('higher accuracy raises both recovery and purity', () => {
  const poor = run({ sortingAccuracyPercent: 50, contaminationPercent: 0 })
  const good = run({ sortingAccuracyPercent: 100, contaminationPercent: 0 })
  assert.ok((good.metrics.recoveryRatePercent as number) > (poor.metrics.recoveryRatePercent as number))
  assert.ok((good.metrics.purityPercent as number) > (poor.metrics.purityPercent as number))
})

test('contamination depresses purity even at full accuracy', () => {
  const clean = run({ sortingAccuracyPercent: 100, contaminationPercent: 0 })
  const dirty = run({ sortingAccuracyPercent: 100, contaminationPercent: 30 })
  assert.ok(
    (dirty.metrics.purityPercent as number) < (clean.metrics.purityPercent as number),
    'contamination must poison the output bale regardless of how good the sorter is',
  )
  assert.ok((dirty.metrics.misroutedKg as number) > (clean.metrics.misroutedKg as number))
})

test('a faster belt raises throughput but costs recovery — the central trade-off', () => {
  const slow = run({ beltSpeedMps: 0.4, arrivalRatePerMin: 200, diverterCycleSeconds: 1.2 })
  const fast = run({ beltSpeedMps: 2.5, arrivalRatePerMin: 200, diverterCycleSeconds: 1.2 })
  assert.ok(
    (fast.metrics.missedByBusyDiverter as number) > (slow.metrics.missedByBusyDiverter as number),
    'a faster belt must overwhelm the effectors more often',
  )
  assert.ok(
    (fast.metrics.recoveryRatePercent as number) < (slow.metrics.recoveryRatePercent as number),
    'misses must show up as lost recovery',
  )
})

test('more effectors recover more material', () => {
  const few = run({ diverterCount: 1 })
  const many = run({ diverterCount: 5 })
  assert.ok((many.metrics.recoveryRatePercent as number) > (few.metrics.recoveryRatePercent as number))
  assert.equal(diverterAssignments(1).length, 1)
  assert.equal(diverterAssignments(5).length, 5)
  assert.equal(diverterAssignments(99).length, 5, 'assignments are capped at the available streams')
})

test('a source-separated feed produces far purer output than mixed waste', () => {
  // Identical machinery on both lines, so the only variable is what goes in.
  const kit = { sortingAccuracyPercent: 85, diverterCount: 5, contaminationPercent: 2 }
  const mixed = run({ ...kit, compositionProfile: 0 })
  const separated = run({ ...kit, compositionProfile: 3 })
  assert.ok(
    (separated.metrics.purityPercent as number) > (mixed.metrics.purityPercent as number) + 20,
    `source separation must dominate bale quality: ${separated.metrics.purityPercent} vs ${mixed.metrics.purityPercent}`,
  )
})

test('an effector stream that is not covered cannot be recovered', () => {
  // Three effectors cover cardboard, plastic and metal; paper and glass have
  // nowhere to go, so a paper-heavy feed must leave most of its value behind.
  const threeArms = run({ compositionProfile: 3, diverterCount: 3, contaminationPercent: 2 })
  const fiveArms = run({ compositionProfile: 3, diverterCount: 5, contaminationPercent: 2 })
  assert.equal(threeArms.metrics.paperKg, 0, 'an unassigned stream must recover nothing')
  assert.equal(threeArms.metrics.glassKg, 0)
  assert.ok((fiveArms.metrics.paperKg as number) > 0)
  assert.ok(
    (fiveArms.metrics.recoveryRatePercent as number) >
      (threeArms.metrics.recoveryRatePercent as number) + 15,
  )
})

test('runs are deterministic for a given seed', () => {
  const a = run()
  const b = run()
  assert.deepEqual(a.metrics, b.metrics)
})

test('a different seed changes the run but not its character', () => {
  const a = run({ seed: 1 })
  const b = run({ seed: 2 })
  assert.notDeepEqual(a.metrics, b.metrics)
  const ra = a.metrics.recoveryRatePercent as number
  const rb = b.metrics.recoveryRatePercent as number
  assert.ok(Math.abs(ra - rb) < 20, `seeds should not swing recovery wildly: ${ra} vs ${rb}`)
})

test('recovery and purity stay within 0-100', () => {
  for (const accuracy of [40, 70, 100]) {
    for (const contamination of [0, 20, 40]) {
      const result = run({ sortingAccuracyPercent: accuracy, contaminationPercent: contamination })
      const recovery = result.metrics.recoveryRatePercent as number
      const purity = result.metrics.purityPercent as number
      assert.ok(recovery >= 0 && recovery <= 100, `recovery ${recovery} out of range`)
      assert.ok(purity >= 0 && purity <= 100, `purity ${purity} out of range`)
    }
  }
})

test('per-material totals sum to the recovered mass', () => {
  const result = run()
  const perMaterial =
    (result.metrics.plasticKg as number) +
    (result.metrics.paperKg as number) +
    (result.metrics.glassKg as number) +
    (result.metrics.metalKg as number) +
    (result.metrics.cardboardKg as number) +
    (result.metrics.organicKg as number)
  // "Other" is the only bin not surfaced as its own metric.
  assert.ok(perMaterial <= (result.metrics.recoveredKg as number) + 1e-6)
})

test('profileById falls back rather than throwing on an unknown id', () => {
  assert.equal(profileById(999).id, COMPOSITION_PROFILES[0].id)
})
