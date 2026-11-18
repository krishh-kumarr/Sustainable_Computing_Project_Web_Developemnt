/**
 * FAO-56 irrigation engine: water balance closure, stress response and strategy trade-offs.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CROPS,
  agricultureEngine,
  cropById,
  type AgricultureBaseline,
} from '../src/simulation/engines/agriculture.ts'
import { runToCompletion } from '../src/simulation/types/engine.ts'
import { defaultValues } from '../src/simulation/types/parameters.ts'
import {
  readilyAvailableWaterMm,
  soilTextureById,
  stepSoilWater,
  stressCoefficient,
  totalAvailableWaterMm,
} from '../src/simulation/models/waterBalance.ts'

const defaults = defaultValues(agricultureEngine.parameters)

function baseline(rainfallMm = 1.5): AgricultureBaseline {
  return {
    dailyEt0Mm: new Array(30).fill(5),
    dailyRainfallMm: new Array(30).fill(rainfallMm),
    dailyMeanTemperatureC: new Array(30).fill(22),
    observedSoilMoisture: 0.26,
    meanIrradianceKwhPerM2Day: 5.4,
    locationLabel: 'Test',
    provenance: [],
    seededFromObservation: true,
  }
}

const run = (overrides: Record<string, number> = {}, b = baseline()) =>
  runToCompletion(agricultureEngine, { ...defaults, ...overrides }, b)

test('TAW and RAW follow the FAO-56 definitions', () => {
  const soil = { fieldCapacity: 0.29, wiltingPoint: 0.14, rootingDepthM: 1.2, depletionFraction: 0.5 }
  // TAW = 1000 * (0.29 - 0.14) * 1.2 = 180 mm
  assert.ok(Math.abs(totalAvailableWaterMm(soil) - 180) < 1e-9)
  assert.ok(Math.abs(readilyAvailableWaterMm(soil) - 90) < 1e-9)
})

test('Ks is 1 until depletion passes RAW, then falls linearly to 0 at TAW', () => {
  const soil = { fieldCapacity: 0.3, wiltingPoint: 0.1, rootingDepthM: 1, depletionFraction: 0.5 }
  const taw = totalAvailableWaterMm(soil)
  const raw = readilyAvailableWaterMm(soil)
  assert.equal(stressCoefficient(0, soil), 1)
  assert.equal(stressCoefficient(raw, soil), 1)
  assert.ok(Math.abs(stressCoefficient((raw + taw) / 2, soil) - 0.5) < 1e-9)
  assert.equal(stressCoefficient(taw, soil), 0)
  assert.equal(stressCoefficient(taw * 2, soil), 0, 'Ks never goes negative')
})

test('the soil step conserves water: inputs equal uptake plus drainage plus storage change', () => {
  const soil = { fieldCapacity: 0.3, wiltingPoint: 0.1, rootingDepthM: 1, depletionFraction: 0.5 }
  const before = 40
  const step = stepSoilWater(before, soil, {
    et0Mm: 5,
    kc: 1.1,
    rainfallMm: 20,
    effectiveRainfallFraction: 0.8,
    appliedIrrigationMm: 30,
    applicationEfficiency: 0.8,
  })
  const inputs = step.effectiveRainfallMm + step.netIrrigationMm
  const outputs = step.etcAdjustedMm + step.deepPercolationMm
  const storageChange = before - step.depletionMm
  assert.ok(Math.abs(inputs - outputs - storageChange) < 1e-9, 'the balance must close exactly')
})

test('rainfed irrigation applies nothing and accumulates stress', () => {
  const result = run({ strategy: 3 }, baseline(0.2))
  assert.equal(result.metrics.totalIrrigationMm, 0)
  assert.equal(result.metrics.irrigationEvents, 0)
  assert.equal(result.metrics.waterProductivity, null, 'no water applied means no ratio, not a zero')
  assert.ok((result.metrics.stressDays as number) > 0, 'a dry rainfed run must show stress')
})

test('irrigating removes the stress that a rainfed run suffers', () => {
  const dry = baseline(0.2)
  const rainfed = run({ strategy: 3 }, dry)
  const irrigated = run({ strategy: 1, irrigationDepthMm: 40 }, dry)
  assert.ok(
    (irrigated.metrics.stressDays as number) < (rainfed.metrics.stressDays as number),
    'irrigation must reduce stress days',
  )
  assert.ok(
    (irrigated.metrics.etcActualMm as number) > (rainfed.metrics.etcActualMm as number),
    'relieving stress must raise actual transpiration',
  )
})

test('soil-moisture triggering uses less water than a fixed calendar for the same stress outcome', () => {
  const wetSeason = baseline(4)
  const calendar = run({ strategy: 0, irrigationDepthMm: 40, irrigationIntervalDays: 7 }, wetSeason)
  const triggered = run({ strategy: 1, irrigationDepthMm: 40 }, wetSeason)
  assert.ok(
    (triggered.metrics.totalIrrigationMm as number) < (calendar.metrics.totalIrrigationMm as number),
    'a calendar schedule irrigates after rain; a trigger does not',
  )
  assert.ok(
    (triggered.metrics.deepPercolationMm as number) <= (calendar.metrics.deepPercolationMm as number),
    'less over-application must mean less drainage',
  )
})

test('higher application efficiency delivers more water to the crop per mm pumped', () => {
  const dry = baseline(0.3)
  const flood = run({ strategy: 0, applicationEfficiencyPercent: 55 }, dry)
  const drip = run({ strategy: 0, applicationEfficiencyPercent: 92 }, dry)
  assert.ok(
    (drip.metrics.waterProductivity as number) > (flood.metrics.waterProductivity as number),
    'efficiency must show up in transpiration per unit applied',
  )
  assert.ok((drip.metrics.stressDays as number) <= (flood.metrics.stressDays as number))
})

test('deficit irrigation saves water and costs stress — the trade-off must appear', () => {
  const dry = baseline(0.3)
  const full = run({ strategy: 2, deficitFraction: 1 }, dry)
  const deficit = run({ strategy: 2, deficitFraction: 0.5 }, dry)
  assert.ok(
    (deficit.metrics.totalIrrigationMm as number) < (full.metrics.totalIrrigationMm as number),
    'deficit irrigation must use less water',
  )
  assert.ok(
    (deficit.metrics.stressIntegral as number) > (full.metrics.stressIntegral as number),
    'and must cost more cumulative stress',
  )
})

test('the shared temperature lever raises demand and stress', () => {
  const dry = baseline(0.5)
  const cool = run({ strategy: 3, temperatureAnomalyK: 0 }, dry)
  const warm = run({ strategy: 3, temperatureAnomalyK: 5 }, dry)
  assert.ok(
    (warm.metrics.etcPotentialMm as number) > (cool.metrics.etcPotentialMm as number),
    'warming must raise reference ET and therefore crop demand',
  )
  assert.ok((warm.metrics.stressIntegral as number) > (cool.metrics.stressIntegral as number))
  assert.ok((warm.metrics.growingDegreeDays as number) > (cool.metrics.growingDegreeDays as number))
})

test('the shared rainfall lever reduces the irrigation a trigger strategy calls for', () => {
  const dryRun = run({ strategy: 1, precipitationScalePercent: 20 })
  const wetRun = run({ strategy: 1, precipitationScalePercent: 250 })
  assert.ok(
    (wetRun.metrics.totalIrrigationMm as number) < (dryRun.metrics.totalIrrigationMm as number),
    'more rain must mean fewer irrigation triggers',
  )
})

test('a sandy soil needs more frequent irrigation than a clay loam', () => {
  // Both start at field capacity, so holding capacity is the only variable.
  // (A single measured volumetric water content cannot be used here: 0.26
  // m3/m3 is saturated in sand and dry in clay, which is exactly why the
  // engine converts an observation to depletion per texture.)
  const dry: AgricultureBaseline = { ...baseline(0.2), observedSoilMoisture: null }
  const sand = run({ strategy: 1, soilTexture: 0, irrigationDepthMm: 25 }, dry)
  const clayLoam = run({ strategy: 1, soilTexture: 3, irrigationDepthMm: 25 }, dry)
  assert.ok(
    (sand.metrics.irrigationEvents as number) > (clayLoam.metrics.irrigationEvents as number),
    `low holding capacity must force more frequent events: sand ${sand.metrics.irrigationEvents} vs clay loam ${clayLoam.metrics.irrigationEvents}`,
  )
})

test('an observed moisture value is read against each texture, not applied blindly', () => {
  // 0.26 m3/m3 is above field capacity for sand (0.12) and well below it for
  // clay (0.40). The engine must start the sand run full and the clay run dry.
  const observed = baseline(0.2)
  const sand = run({ strategy: 3, soilTexture: 0 }, observed)
  const clay = run({ strategy: 3, soilTexture: 4 }, observed)
  assert.ok(
    (clay.metrics.stressIntegral as number) > (sand.metrics.stressIntegral as number),
    'the same reading must mean a drier start in clay than in sand',
  )
})

test('soil water content stays between wilting point and field capacity', () => {
  for (const texture of [0, 2, 4]) {
    for (const strategy of [0, 1, 2, 3]) {
      const result = run({ soilTexture: texture, strategy })
      const profile = soilTextureById(texture).profile
      const moisture = result.metrics.finalSoilMoisture as number
      assert.ok(
        moisture >= profile.wiltingPoint - 1e-9 && moisture <= profile.fieldCapacity + 1e-9,
        `texture ${texture} strategy ${strategy} gave ${moisture}`,
      )
    }
  }
})

test('actual transpiration never exceeds potential demand', () => {
  for (const strategy of [0, 1, 2, 3]) {
    const result = run({ strategy })
    assert.ok(
      (result.metrics.etcActualMm as number) <= (result.metrics.etcPotentialMm as number) + 1e-9,
      'Ks is a damping factor and can never exceed 1',
    )
    assert.ok((result.metrics.deficitMm as number) >= -1e-9)
  }
})

test('runs are deterministic', () => {
  const a = run()
  const b = run()
  assert.deepEqual(a.metrics, b.metrics)
})

test('observed values pass through unmodified', () => {
  const result = run({ temperatureAnomalyK: 5, strategy: 2 })
  assert.equal(result.metrics.observedSoilMoisture, 0.26)
  assert.equal(result.metrics.observedIrradiance, 5.4)
})

test('a missing soil-moisture observation does not become a fabricated start value', () => {
  const noObservation: AgricultureBaseline = { ...baseline(), observedSoilMoisture: null }
  const result = runToCompletion(agricultureEngine, defaults, noObservation)
  assert.equal(result.metrics.observedSoilMoisture, null)
})

test('every crop preset carries an FAO-56 coefficient in a plausible range', () => {
  for (const crop of CROPS) {
    assert.ok(crop.kcMid >= 0.8 && crop.kcMid <= 1.3, `${crop.label} Kc ${crop.kcMid}`)
    assert.ok(crop.rootingDepthM > 0 && crop.rootingDepthM <= 2)
  }
  assert.equal(cropById(999).id, CROPS[0].id, 'unknown ids fall back rather than throwing')
})
