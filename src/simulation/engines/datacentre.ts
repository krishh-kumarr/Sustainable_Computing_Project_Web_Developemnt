/**
 * Green data centre engine.
 *
 * Extends the Phase 1 static PUE calculator into a time-stepping facility
 * model with a real feedback loop: IT load produces heat, cooling removes it
 * at a finite rate, hall temperature is the integral of the difference, and if
 * temperature crosses the thermal limit the facility throttles — which is
 * exactly what makes under-provisioned cooling expensive rather than merely
 * warm.
 *
 * Nothing here is measured. No free public API reports power draw for an
 * arbitrary data centre, and this engine does not pretend one does. Every
 * output is a deterministic function of the inputs on screen.
 *
 * PUE follows The Green Grid / ISO-IEC 30134-2:
 *   PUE = Total Facility Energy / IT Equipment Energy
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

export interface DataCentreBaseline extends EngineBaseline {
  /** Outside air temperature, °C, where an observation is available. It sets
   *  how much free cooling the facility can use. */
  outdoorTemperatureC: number | null
  locationLabel: string
}

export const EMPTY_DATACENTRE_BASELINE: DataCentreBaseline = {
  outdoorTemperatureC: null,
  locationLabel: 'Not location-dependent',
  provenance: ['No outdoor temperature observation loaded; free-cooling benefit is not applied.'],
  seededFromObservation: false,
}

export interface DataCentreState {
  /** Simulated hours completed. */
  hour: number
  /** Hall air temperature, °C. */
  hallTemperatureC: number
  /** Utilisation actually achieved this hour after any thermal throttling, %. */
  achievedUtilisationPercent: number
  /** Utilisation the workload asked for this hour, %. */
  demandedUtilisationPercent: number
  itPowerKw: number
  coolingPowerKw: number
  cumulativeItEnergyKwh: number
  cumulativeTotalEnergyKwh: number
  cumulativeEmissionsKg: number
  cumulativeCost: number
  /** Hours during which thermal limits forced the load down. */
  throttledHours: number
  peakTotalPowerKw: number
  peakHallTemperatureC: number
  /** Useful work completed, in server-utilisation-hours. */
  workUnits: number
}

/**
 * Thermal mass of the hall, kWh per kelvin per 100 servers.
 *
 * Covers room air, rack and chassis steel, slab and structure, and the
 * chilled-water inventory in the loop — the last of which usually dominates.
 * A real figure comes from a CFD or commissioning study of the specific room;
 * this is an order-of-magnitude placeholder and is stated as such.
 */
export const THERMAL_MASS_KWH_PER_K_PER_100_SERVERS = 15

/**
 * Sub-steps per tick for the thermal integration.
 *
 * The hall is a proportional-control feedback loop, and explicit Euler on it
 * is only stable while Δt < 2C/K. With a one-hour tick, a small hall and a
 * large cooling plant that condition can fail, and the temperature would
 * oscillate — a numerical artefact that would read as real thermal behaviour.
 * Sub-stepping removes it.
 */
export const THERMAL_SUBSTEPS = 12

/** Cooling output ramps linearly over this band above setpoint, K. */
export const COOLING_PROPORTIONAL_BAND_K = 6

/** Above this hall temperature the fleet throttles to protect hardware. */
export const THERMAL_THROTTLE_C = 32
/** Throttling is complete by this temperature. */
export const THERMAL_SHUTDOWN_C = 40

/**
 * Free-cooling benefit. When outside air is well below the setpoint a facility
 * can use economiser modes, cutting chiller work. Modelled as a linear
 * reduction in the overhead fraction, capped at 60 %. ASHRAE economiser
 * guidance supports the direction; the coefficient here is illustrative.
 */
export const FREE_COOLING_PER_K_BELOW = 0.012
export const FREE_COOLING_MAX_REDUCTION = 0.6

const PARAMETERS: ParameterSpec[] = [
  {
    key: 'serverCount',
    label: 'Active servers',
    unit: 'servers',
    min: 10,
    max: 5000,
    step: 10,
    default: 500,
    decimals: 0,
    group: 'Fleet',
    note: 'Size of the modelled fleet. Scales IT load, heat output and thermal mass together.',
  },
  {
    key: 'ratedPowerWattsPerServer',
    label: 'Rated IT power per server',
    unit: 'W',
    min: 100,
    max: 1200,
    step: 10,
    default: 450,
    decimals: 0,
    group: 'Fleet',
    note: 'Nameplate draw at full load. Read it off your own hardware; do not accept this default as fact.',
  },
  {
    key: 'idlePowerFraction',
    label: 'Idle power fraction',
    unit: '× rated',
    min: 0.2,
    max: 0.9,
    step: 0.05,
    default: 0.5,
    decimals: 2,
    group: 'Fleet',
    note: 'Power at 0 % utilisation as a fraction of rated. The model interpolates linearly between idle and rated; real curves are mildly non-linear.',
  },
  {
    key: 'baseUtilisationPercent',
    label: 'Mean fleet utilisation',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    default: 45,
    decimals: 0,
    group: 'Workload',
    note: 'Daily mean CPU utilisation the workload asks for, before any thermal throttling.',
  },
  {
    key: 'diurnalSwingPercent',
    label: 'Diurnal workload swing',
    unit: '± %',
    min: 0,
    max: 50,
    step: 1,
    default: 20,
    decimals: 0,
    group: 'Workload',
    note: 'Amplitude of the daily demand cycle around the mean, peaking at 15:00 local. Set to 0 for a flat load.',
  },
  {
    key: 'coolingOverheadFraction',
    label: 'Cooling & distribution overhead',
    unit: '× IT load',
    min: 0.02,
    max: 1.5,
    step: 0.01,
    default: 0.5,
    decimals: 2,
    group: 'Cooling',
    note: 'Non-IT facility energy per unit of IT energy at design conditions. This is what sets the design PUE: PUE = 1 + this value, before free cooling.',
  },
  {
    key: 'coolingCapacityRatio',
    label: 'Cooling capacity',
    unit: '× peak IT heat',
    min: 0.5,
    max: 2,
    step: 0.05,
    default: 1.15,
    decimals: 2,
    group: 'Cooling',
    note: 'Installed cooling capacity relative to peak IT heat output. Below 1.0 the hall cannot reject all its heat at peak and will throttle.',
  },
  {
    key: 'coolingSetpointC',
    label: 'Cooling setpoint',
    unit: '°C',
    min: 18,
    max: 30,
    step: 0.5,
    default: 24,
    decimals: 1,
    group: 'Cooling',
    note: 'Supply-air setpoint. ASHRAE TC 9.9 allows up to 27 °C for most Class A1 equipment; raising it cuts chiller work but leaves less thermal headroom.',
  },
  {
    key: 'renewableSharePercent',
    label: 'Renewable supply share',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    default: 30,
    decimals: 0,
    group: 'Supply',
    sharedKey: 'renewableSharePercent',
    note: 'Share treated as zero-carbon at the point of use. Excludes embodied generation emissions and the gap between contractual and physical supply. Shared with Smart City.',
  },
  {
    key: 'gridCarbonIntensity',
    label: 'Grid carbon intensity',
    unit: 'gCO₂e/kWh',
    min: 10,
    max: 900,
    step: 5,
    default: 450,
    decimals: 0,
    group: 'Supply',
    sharedKey: 'gridCarbonIntensity',
    note: 'Carbon intensity of the non-renewable share. Regional and hourly in reality; a single annual average here. Shared with Smart City.',
  },
  {
    key: 'electricityPricePerKwh',
    label: 'Electricity price',
    unit: 'per kWh',
    min: 0.02,
    max: 0.6,
    step: 0.01,
    default: 0.12,
    decimals: 2,
    group: 'Supply',
    note: 'Your tariff, in your own currency. Affects the cost line only.',
  },
]

const METRICS: MetricDefinition[] = [
  { key: 'pue', label: 'PUE (run average)', unit: '', kind: 'model', decimals: 3, lowerIsBetter: true, headline: true, note: 'Total facility energy ÷ IT equipment energy over the whole run, which is how the standard defines it — not an instantaneous reading.' },
  { key: 'totalEnergyMwh', label: 'Facility energy', unit: 'MWh', kind: 'model', decimals: 2, lowerIsBetter: true, headline: true },
  { key: 'emissionsTonnes', label: 'Operational emissions', unit: 'tCO₂e', kind: 'model', decimals: 2, lowerIsBetter: true, headline: true, note: 'Operational only. Embodied carbon from manufacturing and disposing of the hardware is excluded entirely.' },
  { key: 'hallTemperatureC', label: 'Hall temperature', unit: '°C', kind: 'model', decimals: 1, headline: true, lowerIsBetter: true },
  { key: 'itEnergyMwh', label: 'IT energy', unit: 'MWh', kind: 'model', decimals: 2, lowerIsBetter: true },
  { key: 'coolingEnergyMwh', label: 'Cooling & overhead energy', unit: 'MWh', kind: 'model', decimals: 2, lowerIsBetter: true },
  { key: 'peakPowerKw', label: 'Peak facility power', unit: 'kW', kind: 'model', decimals: 1, lowerIsBetter: true },
  { key: 'throttledHours', label: 'Hours thermally throttled', unit: 'h', kind: 'model', decimals: 0, lowerIsBetter: true, note: 'Hours when hall temperature forced the fleet below the workload it was asked to run. Capacity you paid for and could not use.' },
  { key: 'workUnits', label: 'Useful work completed', unit: 'server-util-h', kind: 'model', decimals: 0, note: 'Achieved utilisation integrated over the run. Rises with workload and falls when throttling bites.' },
  { key: 'energyPerWorkUnit', label: 'Energy per unit of work', unit: 'kWh / server-util-h', kind: 'model', decimals: 3, lowerIsBetter: true, headline: true, note: 'The efficiency metric that actually matters: facility energy divided by work delivered. A facility can have an excellent PUE and still be wasteful if its servers idle.' },
  { key: 'annualEnergyMwh', label: 'Annualised energy', unit: 'MWh/yr', kind: 'model', decimals: 1, lowerIsBetter: true },
  { key: 'annualEmissionsTonnes', label: 'Annualised emissions', unit: 'tCO₂e/yr', kind: 'model', decimals: 1, lowerIsBetter: true },
  { key: 'annualCost', label: 'Annualised electricity cost', unit: '', kind: 'model', decimals: 0, lowerIsBetter: true },
  { key: 'outdoorTemperatureC', label: 'Observed outdoor temperature', unit: '°C', kind: 'observation', decimals: 1, sourceId: 'open-meteo-forecast', note: 'Real observation for the selected location. Drives the free-cooling term.' },
]

const SERIES: SeriesKey[] = [
  { key: 'utilisation', label: 'Achieved utilisation', unit: '%', colour: '#64816C' },
  { key: 'demanded', label: 'Demanded utilisation', unit: '%', colour: '#8CA8B5' },
  { key: 'itPower', label: 'IT power', unit: 'kW', colour: '#4A6356' },
  { key: 'coolingPower', label: 'Cooling power', unit: 'kW', colour: '#8CA8B5' },
  { key: 'totalPower', label: 'Total facility power', unit: 'kW', colour: '#C39A62' },
  { key: 'hallTemperature', label: 'Hall temperature', unit: '°C', colour: '#C25E3A', secondaryAxis: true },
  { key: 'instantPue', label: 'Instantaneous PUE', unit: '', colour: '#6E6A60', secondaryAxis: true },
]

const PRESETS: ScenarioPreset[] = [
  {
    id: 'conventional',
    label: 'Conventional facility',
    kind: 'baseline',
    description: 'PUE 1.8 by design, low utilisation, mostly grid power. Representative of an older enterprise room.',
    overrides: { coolingOverheadFraction: 0.8, baseUtilisationPercent: 25, renewableSharePercent: 10, coolingSetpointC: 20, coolingCapacityRatio: 1.3, gridCarbonIntensity: 500 },
  },
  {
    id: 'efficient-cooling',
    label: 'Efficient cooling',
    kind: 'alternative',
    description: 'Hot-aisle containment and a raised setpoint cut overhead to 0.25. Same workload, same supply.',
    overrides: { coolingOverheadFraction: 0.25, baseUtilisationPercent: 25, renewableSharePercent: 10, coolingSetpointC: 27, coolingCapacityRatio: 1.15, gridCarbonIntensity: 500 },
  },
  {
    id: 'renewable',
    label: 'Renewable-powered',
    kind: 'alternative',
    description: 'Conventional plant, but 85 % of supply is zero-carbon at the point of use. Emissions fall sharply; energy does not move at all.',
    overrides: { coolingOverheadFraction: 0.8, baseUtilisationPercent: 25, renewableSharePercent: 85, coolingSetpointC: 20, coolingCapacityRatio: 1.3, gridCarbonIntensity: 500 },
  },
  {
    id: 'consolidated',
    label: 'Consolidated workload',
    kind: 'alternative',
    description: 'The same work on 40 % of the servers at 70 % utilisation. Watch energy per unit of work, not PUE.',
    overrides: { serverCount: 200, baseUtilisationPercent: 70, coolingOverheadFraction: 0.8, renewableSharePercent: 10, coolingSetpointC: 20, coolingCapacityRatio: 1.3, gridCarbonIntensity: 500 },
  },
  {
    id: 'optimised',
    label: 'Optimised facility',
    kind: 'optimised',
    description: 'Efficient cooling, consolidated workload and a clean supply together.',
    overrides: { serverCount: 200, baseUtilisationPercent: 70, coolingOverheadFraction: 0.22, renewableSharePercent: 85, coolingSetpointC: 27, coolingCapacityRatio: 1.15, gridCarbonIntensity: 200 },
  },
  {
    id: 'undercooled',
    label: 'Under-provisioned cooling',
    kind: 'alternative',
    description: 'Cooling sized at 0.7× peak heat. The hall overheats and the fleet throttles — a demonstration that cheap cooling is not free.',
    overrides: { coolingCapacityRatio: 0.7, baseUtilisationPercent: 70, diurnalSwingPercent: 25, coolingOverheadFraction: 0.5 },
  },
]

/** Demanded utilisation at a given hour of the simulated day. */
export function workloadAt(hour: number, base: number, swing: number): number {
  // Peaks at 15:00, troughs at 03:00 — a conventional business-hours profile.
  const phase = ((hour % 24) - 15) / 24
  const value = base + swing * Math.cos(2 * Math.PI * phase)
  return Math.min(Math.max(value, 0), 100)
}

/** Per-server draw at a utilisation, W. Linear between idle and rated. */
export function serverPowerWatts(rated: number, idleFraction: number, utilisationPercent: number): number {
  const idle = rated * idleFraction
  return idle + (rated - idle) * (Math.min(Math.max(utilisationPercent, 0), 100) / 100)
}

/** Overhead fraction after the free-cooling benefit from cool outside air. */
export function effectiveOverhead(
  designOverhead: number,
  outdoorTemperatureC: number | null,
  setpointC: number,
): number {
  if (outdoorTemperatureC === null || outdoorTemperatureC >= setpointC) return designOverhead
  const reduction = Math.min(
    FREE_COOLING_PER_K_BELOW * (setpointC - outdoorTemperatureC),
    FREE_COOLING_MAX_REDUCTION,
  )
  return designOverhead * (1 - reduction)
}

/** Fraction of demanded load the fleet can run at a given hall temperature. */
export function throttleFactor(hallTemperatureC: number): number {
  if (hallTemperatureC <= THERMAL_THROTTLE_C) return 1
  if (hallTemperatureC >= THERMAL_SHUTDOWN_C) return 0.1
  return (
    1 -
    (0.9 * (hallTemperatureC - THERMAL_THROTTLE_C)) / (THERMAL_SHUTDOWN_C - THERMAL_THROTTLE_C)
  )
}

export const dataCentreEngine: SimulationEngine<DataCentreState, DataCentreBaseline> = {
  id: 'datacentre',
  label: 'Data centre energy & thermal engine',
  tickHours: 1,
  defaultDurationHours: 24 * 14,
  timeUnit: 'hours',
  parameters: PARAMETERS,
  metrics: METRICS,
  series: SERIES,
  presets: PRESETS,
  disclaimer:
    'A transparent facility calculator with a thermal feedback loop. No free public API reports live power for an arbitrary data centre, and nothing here is measured — every value is a deterministic function of the inputs shown. Thermal mass, the free-cooling coefficient and the throttling curve are illustrative parameterisations, not measurements of any real room.',
  assumptions: [
    'All IT electrical power becomes heat in the hall. This is very nearly exact in a real facility.',
    'Server power is interpolated linearly between idle and rated draw; real power curves are mildly non-linear.',
    'Cooling output ramps linearly over a 6 K proportional band above setpoint and is capped by the installed capacity.',
    `Thermal mass is ${THERMAL_MASS_KWH_PER_K_PER_100_SERVERS} kWh/K per 100 servers, covering room air, rack steel, structure and the chilled-water inventory. An order-of-magnitude placeholder, not a measurement of any real room.`,
    `The hall temperature is integrated in ${THERMAL_SUBSTEPS} sub-steps per hour so the proportional-control loop stays numerically stable; without that, the timestep itself would produce oscillations that look like thermal behaviour.`,
    `The fleet throttles linearly between ${THERMAL_THROTTLE_C} °C and ${THERMAL_SHUTDOWN_C} °C hall temperature, reaching 10 % of demanded load at the upper limit.`,
    'Free cooling reduces the overhead fraction by 1.2 % per kelvin that outside air sits below setpoint, capped at 60 %. The direction follows ASHRAE economiser guidance; the coefficient is illustrative.',
    'Renewable supply is zero-carbon at the point of use. It ignores embodied generation emissions, curtailment, and the difference between contractual and physical supply.',
    'Grid carbon intensity is a single annual average. Real intensity swings hourly with the generation mix.',
    'Embodied carbon from manufacturing and disposing of the hardware is excluded entirely. For many facilities that is a large share of lifetime emissions.',
  ],

  init(params) {
    return {
      hour: 0,
      // Start at setpoint: the facility is assumed to be in steady operation.
      hallTemperatureC: params.coolingSetpointC,
      achievedUtilisationPercent: params.baseUtilisationPercent,
      demandedUtilisationPercent: params.baseUtilisationPercent,
      itPowerKw: 0,
      coolingPowerKw: 0,
      cumulativeItEnergyKwh: 0,
      cumulativeTotalEnergyKwh: 0,
      cumulativeEmissionsKg: 0,
      cumulativeCost: 0,
      throttledHours: 0,
      peakTotalPowerKw: 0,
      peakHallTemperatureC: params.coolingSetpointC,
      workUnits: 0,
    }
  },

  step(state, params, baseline, tickHours) {
    const demanded = workloadAt(state.hour, params.baseUtilisationPercent, params.diurnalSwingPercent)

    // Thermal state from the previous hour limits what the fleet can run now.
    const factor = throttleFactor(state.hallTemperatureC)
    const achieved = demanded * factor

    const itPowerKw =
      (serverPowerWatts(params.ratedPowerWattsPerServer, params.idlePowerFraction, achieved) *
        params.serverCount) /
      1000

    const overhead = effectiveOverhead(
      params.coolingOverheadFraction,
      baseline.outdoorTemperatureC,
      params.coolingSetpointC,
    )

    // Cooling plant is sized against peak IT heat, not current heat.
    const peakItKw = (params.ratedPowerWattsPerServer * params.serverCount) / 1000
    const coolingCapacityKw = peakItKw * params.coolingCapacityRatio

    const thermalMassKwhPerK = Math.max(
      (THERMAL_MASS_KWH_PER_K_PER_100_SERVERS * params.serverCount) / 100,
      0.1,
    )

    // Integrate the hall temperature in sub-steps. Proportional control:
    // cooling output ramps with the error above setpoint and is capped by the
    // installed capacity, so an under-sized plant simply cannot keep up.
    const cop = overhead > 0 ? 1 / overhead : 50
    const subDt = tickHours / THERMAL_SUBSTEPS
    let hallTemperatureC = state.hallTemperatureC
    let coolingEnergyKwh = 0

    for (let i = 0; i < THERMAL_SUBSTEPS; i++) {
      const error = hallTemperatureC - params.coolingSetpointC
      const demandFraction = Math.min(Math.max(error / COOLING_PROPORTIONAL_BAND_K, 0), 1)
      const heatRemovedKw = coolingCapacityKw * demandFraction
      coolingEnergyKwh += (heatRemovedKw / cop) * subDt
      const netHeatKw = itPowerKw - heatRemovedKw
      hallTemperatureC = Math.max(
        hallTemperatureC + (netHeatKw * subDt) / thermalMassKwhPerK,
        // The plant cannot drive the hall below its own setpoint.
        params.coolingSetpointC,
      )
    }

    const coolingPowerKw = tickHours > 0 ? coolingEnergyKwh / tickHours : 0

    const totalPowerKw = itPowerKw + coolingPowerKw
    const totalEnergyKwh = totalPowerKw * tickHours
    const fossilShare = 1 - Math.min(Math.max(params.renewableSharePercent, 0), 100) / 100
    const emissionsKg = (totalEnergyKwh * fossilShare * params.gridCarbonIntensity) / 1000

    return {
      hour: state.hour + tickHours,
      hallTemperatureC,
      achievedUtilisationPercent: achieved,
      demandedUtilisationPercent: demanded,
      itPowerKw,
      coolingPowerKw,
      cumulativeItEnergyKwh: state.cumulativeItEnergyKwh + itPowerKw * tickHours,
      cumulativeTotalEnergyKwh: state.cumulativeTotalEnergyKwh + totalEnergyKwh,
      cumulativeEmissionsKg: state.cumulativeEmissionsKg + emissionsKg,
      cumulativeCost: state.cumulativeCost + totalEnergyKwh * params.electricityPricePerKwh,
      throttledHours: state.throttledHours + (factor < 0.999 ? tickHours : 0),
      peakTotalPowerKw: Math.max(state.peakTotalPowerKw, totalPowerKw),
      peakHallTemperatureC: Math.max(state.peakHallTemperatureC, hallTemperatureC),
      workUnits: state.workUnits + (achieved / 100) * params.serverCount * tickHours,
    }
  },

  derive(state, _params, baseline) {
    const hours = Math.max(state.hour, 1)
    const annualScale = 8760 / hours
    const pue =
      state.cumulativeItEnergyKwh > 0
        ? state.cumulativeTotalEnergyKwh / state.cumulativeItEnergyKwh
        : null

    return {
      pue,
      totalEnergyMwh: state.cumulativeTotalEnergyKwh / 1000,
      itEnergyMwh: state.cumulativeItEnergyKwh / 1000,
      coolingEnergyMwh: (state.cumulativeTotalEnergyKwh - state.cumulativeItEnergyKwh) / 1000,
      emissionsTonnes: state.cumulativeEmissionsKg / 1000,
      hallTemperatureC: state.hallTemperatureC,
      peakPowerKw: state.peakTotalPowerKw,
      throttledHours: state.throttledHours,
      workUnits: state.workUnits,
      energyPerWorkUnit: state.workUnits > 0 ? state.cumulativeTotalEnergyKwh / state.workUnits : null,
      annualEnergyMwh: (state.cumulativeTotalEnergyKwh / 1000) * annualScale,
      annualEmissionsTonnes: (state.cumulativeEmissionsKg / 1000) * annualScale,
      annualCost: state.cumulativeCost * annualScale,
      outdoorTemperatureC: baseline.outdoorTemperatureC,
    }
  },

  sample(state) {
    const totalPower = state.itPowerKw + state.coolingPowerKw
    return {
      t: Number(state.hour.toFixed(2)),
      utilisation: Number(state.achievedUtilisationPercent.toFixed(2)),
      demanded: Number(state.demandedUtilisationPercent.toFixed(2)),
      itPower: Number(state.itPowerKw.toFixed(2)),
      coolingPower: Number(state.coolingPowerKw.toFixed(2)),
      totalPower: Number(totalPower.toFixed(2)),
      hallTemperature: Number(state.hallTemperatureC.toFixed(2)),
      instantPue: state.itPowerKw > 0 ? Number((totalPower / state.itPowerKw).toFixed(3)) : null,
    } satisfies SeriesRow
  },

  explain(state, params, baseline) {
    const r = (value: number, decimals = 2) => value.toFixed(decimals)
    const overhead = effectiveOverhead(
      params.coolingOverheadFraction,
      baseline.outdoorTemperatureC,
      params.coolingSetpointC,
    )
    const pue =
      state.cumulativeItEnergyKwh > 0
        ? state.cumulativeTotalEnergyKwh / state.cumulativeItEnergyKwh
        : 0
    const fossilShare = 1 - params.renewableSharePercent / 100

    return [
      `Demanded utilisation at hour ${state.hour % 24} = ${params.baseUtilisationPercent}% ± ${params.diurnalSwingPercent}% diurnal = ${r(state.demandedUtilisationPercent, 1)}%`,
      `Thermal throttle at ${r(state.hallTemperatureC, 1)} °C hall → factor ${r(throttleFactor(state.hallTemperatureC), 3)} → achieved ${r(state.achievedUtilisationPercent, 1)}%`,
      `Per-server power = ${r(params.ratedPowerWattsPerServer * params.idlePowerFraction, 0)} W idle + ${r(params.ratedPowerWattsPerServer * (1 - params.idlePowerFraction), 0)} W × ${r(state.achievedUtilisationPercent, 0)}% = ${r(serverPowerWatts(params.ratedPowerWattsPerServer, params.idlePowerFraction, state.achievedUtilisationPercent), 0)} W`,
      `IT power = that × ${params.serverCount} servers = ${r(state.itPowerKw, 1)} kW, all of which becomes heat`,
      baseline.outdoorTemperatureC !== null && baseline.outdoorTemperatureC < params.coolingSetpointC
        ? `Free cooling: outside air ${r(baseline.outdoorTemperatureC, 1)} °C is ${r(params.coolingSetpointC - baseline.outdoorTemperatureC, 1)} K below setpoint → overhead ${params.coolingOverheadFraction} → ${r(overhead, 3)}`
        : `No free-cooling benefit applied (outside air at or above setpoint, or unobserved). Overhead stays at ${params.coolingOverheadFraction}.`,
      `Cooling COP = 1 / ${r(overhead, 3)} = ${r(1 / Math.max(overhead, 1e-6), 2)}; cooling power = heat removed ÷ COP = ${r(state.coolingPowerKw, 1)} kW`,
      `Hall temperature integrates net heat: dT = (IT heat − heat removed) × Δt ÷ thermal mass → ${r(state.hallTemperatureC, 2)} °C`,
      `PUE over the run = ${r(state.cumulativeTotalEnergyKwh / 1000, 2)} MWh total ÷ ${r(state.cumulativeItEnergyKwh / 1000, 2)} MWh IT = ${r(pue, 3)}`,
      `Emissions = ${r(state.cumulativeTotalEnergyKwh / 1000, 2)} MWh × ${r(fossilShare * 100, 0)}% non-renewable × ${params.gridCarbonIntensity} gCO₂e/kWh = ${r(state.cumulativeEmissionsKg / 1000, 2)} tCO₂e`,
      `Energy per unit of work = ${r(state.cumulativeTotalEnergyKwh, 0)} kWh ÷ ${r(state.workUnits, 0)} server-util-h = ${state.workUnits > 0 ? r(state.cumulativeTotalEnergyKwh / state.workUnits, 3) : '—'} kWh`,
    ]
  },

  elapsedHours(state) {
    return state.hour
  },
}
