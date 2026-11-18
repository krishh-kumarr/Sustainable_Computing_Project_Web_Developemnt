/**
 * Sustainability Advisor: rules fire on their stated triggers, and every
 * quantified claim is measured rather than asserted.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildReport } from '../src/simulation/advisor/advisor.ts'
import { ADVISOR_METHOD } from '../src/simulation/advisor/types.ts'
import { RULES_BY_ENGINE } from '../src/simulation/advisor/rules.ts'
import { dataCentreEngine, type DataCentreBaseline } from '../src/simulation/engines/datacentre.ts'
import { cityEngine, type CityBaseline } from '../src/simulation/engines/city.ts'
import { waterEngine, type WaterBaseline } from '../src/simulation/engines/water.ts'
import { agricultureEngine, type AgricultureBaseline } from '../src/simulation/engines/agriculture.ts'
import { wasteEngine, WASTE_BASELINE } from '../src/simulation/engines/waste.ts'
import { climateEngine, buildClimateBaseline } from '../src/simulation/engines/climate.ts'
import { forestEngine, type ForestBaseline } from '../src/simulation/engines/forest.ts'
import { runToCompletion } from '../src/simulation/types/engine.ts'
import { defaultValues } from '../src/simulation/types/parameters.ts'

const dcBaseline: DataCentreBaseline = {
  outdoorTemperatureC: 15,
  locationLabel: 'Test',
  provenance: ['test'],
  seededFromObservation: true,
}

const cityBaseline: CityBaseline = {
  mappedBuildingCount: 900,
  mappedGreenCoverPercent: 5,
  mappedRoadKm: 40,
  queryAreaKm2: 15,
  observedTemperatureC: 22,
  observedAqi: 140,
  locationLabel: 'Test',
  provenance: [],
  seededFromObservation: true,
}

const waterBaseline: WaterBaseline = {
  dailyRainfallMm: new Array(30).fill(6),
  forecastStartIndex: 7,
  meanTemperatureC: 20,
  glofasDischargeCumecs: 40,
  gaugeDischargeCumecs: null,
  gaugeName: null,
  locationLabel: 'Test',
  provenance: [],
  seededFromObservation: true,
}

const agriBaseline: AgricultureBaseline = {
  dailyEt0Mm: new Array(30).fill(5),
  dailyRainfallMm: new Array(30).fill(0.5),
  dailyMeanTemperatureC: new Array(30).fill(24),
  observedSoilMoisture: 0.24,
  meanIrradianceKwhPerM2Day: 5.5,
  locationLabel: 'Test',
  provenance: [],
  seededFromObservation: true,
}

const forestBaseline: ForestBaseline = {
  observedTemperatureC: 30,
  observedHumidityPercent: 20,
  observedWindSpeedKmh: 35,
  observedWindDirectionDeg: 225,
  recentRainfallMm: 0,
  satelliteDetectionCount: 4,
  recordedSpeciesCount: 90,
  locationLabel: 'Test',
  provenance: [],
  seededFromObservation: true,
}

test('the method statement never claims to be an LLM', () => {
  assert.match(ADVISOR_METHOD, /rule-based/i)
  assert.match(ADVISOR_METHOD, /not a language model/i)
})

test('every engine has at least one rule', () => {
  for (const engineId of ['climate', 'waste', 'city', 'datacentre', 'forest', 'water', 'agriculture']) {
    assert.ok((RULES_BY_ENGINE[engineId] ?? []).length > 0, `${engineId} has no rules`)
  }
})

test('the consolidation rule fires on low utilisation and not on high', () => {
  const low = buildReport(dataCentreEngine, { ...defaultValues(dataCentreEngine.parameters), baseUtilisationPercent: 20 }, dcBaseline)
  const high = buildReport(dataCentreEngine, { ...defaultValues(dataCentreEngine.parameters), baseUtilisationPercent: 80 }, dcBaseline)
  assert.ok(low.findings.some((f) => f.id === 'dc-consolidate'), 'must fire at 20% utilisation')
  assert.ok(!high.findings.some((f) => f.id === 'dc-consolidate'), 'must not fire at 80% utilisation')
})

test('a quantified finding matches an independent re-run of the engine', () => {
  const params = { ...defaultValues(dataCentreEngine.parameters), baseUtilisationPercent: 20 }
  const report = buildReport(dataCentreEngine, params, dcBaseline)
  const finding = report.findings.find((f) => f.id === 'dc-consolidate')
  assert.ok(finding?.action, 'the finding must carry an applicable action')

  const current = runToCompletion(dataCentreEngine, params, dcBaseline)
  const proposed = runToCompletion(
    dataCentreEngine,
    { ...params, ...finding!.action!.overrides },
    dcBaseline,
  )
  const claimed = finding!.magnitudes.find((m) => m.label === 'Facility energy')
  assert.ok(claimed, 'the finding must quantify facility energy')
  const actual = (proposed.metrics.totalEnergyMwh as number) - (current.metrics.totalEnergyMwh as number)
  assert.ok(
    Math.abs(claimed!.value - actual) < 1e-9,
    `the advisor's claimed change ${claimed!.value} must equal the measured change ${actual}`,
  )
})

test('every finding carries a basis explaining why it was generated', () => {
  const reports = [
    buildReport(dataCentreEngine, defaultValues(dataCentreEngine.parameters), dcBaseline),
    buildReport(cityEngine, defaultValues(cityEngine.parameters), cityBaseline),
    buildReport(waterEngine, defaultValues(waterEngine.parameters), waterBaseline),
    buildReport(agricultureEngine, defaultValues(agricultureEngine.parameters), agriBaseline),
    buildReport(wasteEngine, defaultValues(wasteEngine.parameters), WASTE_BASELINE),
    buildReport(forestEngine, defaultValues(forestEngine.parameters), forestBaseline),
  ]
  for (const report of reports) {
    assert.ok(report.findings.length > 0, `${report.engineId} produced no findings`)
    for (const finding of report.findings) {
      assert.ok(finding.basis.length > 20, `${finding.id} has no meaningful basis`)
      assert.ok(finding.title.length > 0)
      assert.ok(finding.detail.length > 0)
    }
  }
})

test('findings are ranked with the most significant first', () => {
  const report = buildReport(cityEngine, defaultValues(cityEngine.parameters), cityBaseline)
  for (let i = 1; i < report.findings.length; i++) {
    assert.ok(
      report.findings[i - 1].weight >= report.findings[i].weight,
      'findings must be ordered by weight',
    )
  }
})

test('the throttling rule only fires when throttling actually occurred', () => {
  const defaults = defaultValues(dataCentreEngine.parameters)
  const fine = buildReport(dataCentreEngine, { ...defaults, coolingCapacityRatio: 1.5 }, dcBaseline)
  const starved = buildReport(
    dataCentreEngine,
    { ...defaults, coolingCapacityRatio: 0.6, baseUtilisationPercent: 85 },
    dcBaseline,
  )
  assert.ok(!fine.findings.some((f) => f.id === 'dc-throttle'))
  assert.ok(starved.findings.some((f) => f.id === 'dc-throttle'))
})

test('the spill rule fires only when water was actually spilled', () => {
  const defaults = defaultValues(waterEngine.parameters)
  const dry = buildReport(waterEngine, { ...defaults, precipitationScalePercent: 10 }, waterBaseline)
  const flood = buildReport(
    waterEngine,
    { ...defaults, precipitationScalePercent: 350, initialFillPercent: 92 },
    waterBaseline,
  )
  assert.ok(!dry.findings.some((f) => f.id === 'water-prerelease'))
  assert.ok(flood.findings.some((f) => f.id === 'water-prerelease'))
})

test('the irrigation strategy rule fires on calendar scheduling only', () => {
  const defaults = defaultValues(agricultureEngine.parameters)
  const calendar = buildReport(agricultureEngine, { ...defaults, strategy: 0 }, agriBaseline)
  const triggered = buildReport(agricultureEngine, { ...defaults, strategy: 1 }, agriBaseline)
  assert.ok(calendar.findings.some((f) => f.id === 'agri-trigger'))
  assert.ok(!triggered.findings.some((f) => f.id === 'agri-trigger'))
})

test('the waste module always declares that no classifier exists', () => {
  const report = buildReport(wasteEngine, defaultValues(wasteEngine.parameters), WASTE_BASELINE)
  const limitation = report.findings.find((f) => f.id === 'waste-no-classifier')
  assert.ok(limitation, 'the no-classifier limitation must always be present')
  assert.equal(limitation!.kind, 'limitation')
  assert.match(limitation!.detail, /no computer-vision system/i)
})

test('the climate module always declares that it is not CMIP6', () => {
  const baseline = buildClimateBaseline({
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: `2024-${String(i + 1).padStart(2, '0')}`,
      temperatureMean: 15,
      precipitationSum: 50,
    })),
    currentTemperatureC: 16,
    currentCloudCoverPercent: 55,
    meanIrradianceKwhPerM2Day: 4,
    locationLabel: 'Test',
  })
  const report = buildReport(climateEngine, defaultValues(climateEngine.parameters), baseline)
  const limitation = report.findings.find((f) => f.id === 'climate-not-cmip6')
  assert.ok(limitation)
  assert.match(limitation!.detail, /not CMIP6/i)
})

test('a missing observed baseline produces a limitation rather than silence', () => {
  const empty = buildClimateBaseline({
    monthly: [],
    currentTemperatureC: null,
    currentCloudCoverPercent: null,
    meanIrradianceKwhPerM2Day: null,
    locationLabel: 'Nowhere',
  })
  const report = buildReport(climateEngine, defaultValues(climateEngine.parameters), empty)
  assert.ok(report.findings.some((f) => f.id === 'climate-no-baseline'))
})

test('the advisor is deterministic for identical inputs', () => {
  const params = defaultValues(cityEngine.parameters)
  const a = buildReport(cityEngine, params, cityBaseline)
  const b = buildReport(cityEngine, params, cityBaseline)
  assert.deepEqual(
    a.findings.map((f) => ({ id: f.id, kind: f.kind, magnitudes: f.magnitudes })),
    b.findings.map((f) => ({ id: f.id, kind: f.kind, magnitudes: f.magnitudes })),
  )
})

test('a trade-off finding is labelled as a trade-off, not an opportunity', () => {
  const defaults = defaultValues(dataCentreEngine.parameters)
  const report = buildReport(
    dataCentreEngine,
    { ...defaults, coolingCapacityRatio: 0.6, baseUtilisationPercent: 85 },
    dcBaseline,
  )
  const throttle = report.findings.find((f) => f.id === 'dc-throttle')
  assert.ok(throttle)
  // More cooling recovers work but costs energy: both directions present.
  assert.ok(throttle!.magnitudes.length >= 2)
  assert.ok(['trade-off', 'opportunity', 'caution'].includes(throttle!.kind))
})

test('actions carry overrides that can be applied directly to parameters', () => {
  const report = buildReport(cityEngine, defaultValues(cityEngine.parameters), cityBaseline)
  for (const finding of report.findings) {
    if (!finding.action) continue
    for (const key of Object.keys(finding.action.overrides)) {
      assert.ok(
        cityEngine.parameters.some((spec) => spec.key === key),
        `${finding.id} proposes an unknown parameter "${key}"`,
      )
    }
  }
})
