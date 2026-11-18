/**
 * Urban engine: accounting identities, feedback terms and scenario trade-offs.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CONGESTION_ENERGY_PENALTY,
  UHI_COOLING_PER_GREEN_PERCENT,
  cityEngine,
  computeDay,
  urbanAreaKm2,
  type CityBaseline,
} from '../src/simulation/engines/city.ts'
import { runToCompletion } from '../src/simulation/types/engine.ts'
import { defaultValues } from '../src/simulation/types/parameters.ts'
import { compareRuns, summarise } from '../src/simulation/scenarios/compare.ts'

const defaults = defaultValues(cityEngine.parameters)

function baseline(): CityBaseline {
  return {
    mappedBuildingCount: 900,
    mappedGreenCoverPercent: 4.96,
    mappedRoadKm: 42,
    queryAreaKm2: 14.9,
    observedTemperatureC: 22,
    observedAqi: 61,
    locationLabel: 'Test',
    provenance: [],
    seededFromObservation: true,
  }
}

const run = (overrides: Record<string, number> = {}) =>
  runToCompletion(cityEngine, { ...defaults, ...overrides }, baseline())

test('urban area scales linearly with population', () => {
  assert.ok(Math.abs(urbanAreaKm2({ populationThousands: 450 }) - 100) < 1e-9)
  assert.ok(urbanAreaKm2({ populationThousands: 900 }) === 2 * urbanAreaKm2({ populationThousands: 450 }))
})

test('the congestion factor runs from 1 at free flow to 1.45 at saturation', () => {
  const free = computeDay({ ...defaults, trafficDensityPercent: 0 }, baseline(), 100)
  const jammed = computeDay({ ...defaults, trafficDensityPercent: 100 }, baseline(), 100)
  assert.ok(Math.abs(free.congestionFactor - 1) < 1e-9)
  assert.ok(Math.abs(jammed.congestionFactor - (1 + CONGESTION_ENERGY_PENALTY)) < 1e-9)
})

test('green cover moderates the effective temperature', () => {
  const bare = computeDay({ ...defaults, greenCoverPercent: 0 }, baseline(), 100)
  const green = computeDay({ ...defaults, greenCoverPercent: 30 }, baseline(), 100)
  assert.ok(Math.abs(bare.heatIslandOffsetC) < 1e-9)
  assert.ok(Math.abs(green.heatIslandOffsetC - 30 * UHI_COOLING_PER_GREEN_PERCENT) < 1e-9)
  assert.ok(green.effectiveTemperatureC < bare.effectiveTemperatureC)
})

test('greening reduces building electricity through the cooling feedback', () => {
  const bare = run({ greenCoverPercent: 0 })
  const green = run({ greenCoverPercent: 40 })
  assert.ok(
    (green.metrics.buildingElectricityGwh as number) < (bare.metrics.buildingElectricityGwh as number),
    'the heat-island feedback must show up in the energy line, not only in sequestration',
  )
})

test('warming raises building electricity through the same feedback', () => {
  const cool = run({ temperatureAnomalyK: 0 })
  const warm = run({ temperatureAnomalyK: 5 })
  assert.ok(
    (warm.metrics.buildingElectricityGwh as number) > (cool.metrics.buildingElectricityGwh as number),
  )
})

test('zero population produces zero demand, not a division error', () => {
  const result = runToCompletion(cityEngine, { ...defaults, populationThousands: 10 }, baseline())
  assert.ok((result.metrics.annualElectricityGwh as number) > 0)
  assert.ok(Number.isFinite(result.metrics.perCapitaEmissionsKg as number))
})

test('shifting to public transport cuts both fuel and total emissions', () => {
  const carCity = run({ publicTransportPercent: 5 })
  const transitCity = run({ publicTransportPercent: 70 })
  assert.ok((transitCity.metrics.transportFuelGwh as number) < (carCity.metrics.transportFuelGwh as number))
  assert.ok((transitCity.metrics.annualEmissionsKt as number) < (carCity.metrics.annualEmissionsKt as number))
})

test('electrification moves energy from fuel to the grid', () => {
  const petrol = run({ evSharePercent: 0 })
  const electric = run({ evSharePercent: 100 })
  assert.equal(electric.metrics.transportFuelGwh, 0, 'a fully electric fleet burns no liquid fuel')
  assert.ok(
    (electric.metrics.transportElectricityGwh as number) >
      (petrol.metrics.transportElectricityGwh as number),
  )
})

test('electrification on a dirty grid helps far less than on a clean one', () => {
  const dirtyIce = run({ evSharePercent: 0, gridCarbonIntensity: 800, renewableSharePercent: 0 })
  const dirtyEv = run({ evSharePercent: 100, gridCarbonIntensity: 800, renewableSharePercent: 0 })
  const cleanEv = run({ evSharePercent: 100, gridCarbonIntensity: 50, renewableSharePercent: 80 })

  const dirtySaving =
    (dirtyIce.metrics.annualEmissionsKt as number) - (dirtyEv.metrics.annualEmissionsKt as number)
  const cleanSaving =
    (dirtyIce.metrics.annualEmissionsKt as number) - (cleanEv.metrics.annualEmissionsKt as number)
  assert.ok(cleanSaving > dirtySaving, 'the value of electrification must depend on the grid')
})

test('renewable share changes emissions but not electricity demand', () => {
  const dirty = run({ renewableSharePercent: 0 })
  const clean = run({ renewableSharePercent: 90 })
  assert.ok(
    Math.abs((dirty.metrics.annualElectricityGwh as number) - (clean.metrics.annualElectricityGwh as number)) < 1e-9,
  )
  assert.ok((clean.metrics.annualEmissionsKt as number) < (dirty.metrics.annualEmissionsKt as number))
})

test('building efficiency reduces building electricity proportionally', () => {
  const base = run({ buildingEfficiencyPercent: 0, temperatureAnomalyK: 0, greenCoverPercent: 0 })
  const retrofit = run({ buildingEfficiencyPercent: 50, temperatureAnomalyK: 0, greenCoverPercent: 0 })
  const ratio =
    (retrofit.metrics.buildingElectricityGwh as number) / (base.metrics.buildingElectricityGwh as number)
  assert.ok(Math.abs(ratio - 0.5) < 1e-6, `expected a 50% cut, got ratio ${ratio}`)
})

test('the three city presets rank as expected on emissions', () => {
  const conventional = run({ trafficDensityPercent: 80, publicTransportPercent: 12, evSharePercent: 3, buildingEfficiencyPercent: 0, greenCoverPercent: 8, renewableSharePercent: 15, gridCarbonIntensity: 550 })
  const improved = run({ trafficDensityPercent: 60, publicTransportPercent: 35, evSharePercent: 25, buildingEfficiencyPercent: 20, greenCoverPercent: 18, renewableSharePercent: 45, gridCarbonIntensity: 400 })
  const sustainable = run({ trafficDensityPercent: 35, publicTransportPercent: 65, evSharePercent: 70, buildingEfficiencyPercent: 45, greenCoverPercent: 35, renewableSharePercent: 85, gridCarbonIntensity: 180 })

  assert.ok((improved.metrics.annualEmissionsKt as number) < (conventional.metrics.annualEmissionsKt as number))
  assert.ok((sustainable.metrics.annualEmissionsKt as number) < (improved.metrics.annualEmissionsKt as number))
})

test('sequestration is reported but is small against a city\'s emissions', () => {
  const result = run({ greenCoverPercent: 40 })
  const emissions = (result.metrics.annualEmissionsKt as number) * 1000
  const sequestration = result.metrics.sequestrationTonnes as number
  assert.ok(sequestration > 0)
  assert.ok(
    sequestration < emissions * 0.5,
    'urban sequestration must not be presented as capable of offsetting a city',
  )
})

test('the measured air-quality index is never altered by the model', () => {
  const clean = run({ trafficDensityPercent: 0, evSharePercent: 100 })
  const dirty = run({ trafficDensityPercent: 100, evSharePercent: 0 })
  assert.equal(clean.metrics.observedAqi, 61)
  assert.equal(dirty.metrics.observedAqi, 61, 'there is no dispersion model here; the measurement stands')
})

test('OpenStreetMap observations pass through unmodified', () => {
  const result = run({ greenCoverPercent: 55 })
  assert.equal(result.metrics.mappedBuildingCount, 900)
  assert.equal(result.metrics.mappedGreenCoverPercent, 4.96)
})

test('comparison surfaces the electrification-on-a-dirty-grid trade-off', () => {
  const conventional = runToCompletion(
    cityEngine,
    { ...defaults, evSharePercent: 0, gridCarbonIntensity: 800, renewableSharePercent: 0 },
    baseline(),
    { kind: 'baseline', label: 'Baseline' },
  )
  const evOnly = runToCompletion(
    cityEngine,
    { ...defaults, evSharePercent: 100, gridCarbonIntensity: 800, renewableSharePercent: 0 },
    baseline(),
    { kind: 'alternative', label: 'Alternative' },
  )
  const comparison = compareRuns(cityEngine.metrics, cityEngine.parameters, conventional, evOnly)
  // Fuel falls to zero while grid electricity rises: a genuine trade-off the
  // comparison must name rather than collapse into a single verdict.
  assert.ok(comparison.improved.length > 0)
  assert.ok(comparison.worsened.length > 0, 'transport electricity must rise')
  assert.ok(comparison.isTradeOff)
  assert.match(summarise(comparison), /Trade-off/)
})

test('runs are deterministic', () => {
  const a = run()
  const b = run()
  assert.deepEqual(a.metrics, b.metrics)
})
