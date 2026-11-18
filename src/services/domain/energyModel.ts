/**
 * Data-centre energy and emissions arithmetic.
 *
 * There is no free public API that reports live power draw for an arbitrary
 * data centre, so this module does not pretend to measure one. It is a
 * transparent calculator: every output is a deterministic function of inputs
 * the user sets, and every intermediate step is exposed so the result can be
 * checked by hand.
 *
 * Definitions used:
 *
 *   PUE = Total Facility Energy / IT Equipment Energy
 *         (The Green Grid / ISO-IEC 30134-2)
 *
 *   Total facility energy is modelled as IT energy plus a cooling-and-overhead
 *   fraction of it, which is where the PUE above 1 comes from.
 *
 * Nothing here is a measurement, and nothing here is validated against a real
 * facility. It is labelled MODEL ESTIMATE wherever it is displayed.
 */

export interface EnergyInputs {
  /** Number of servers in the modelled facility. */
  serverCount: number
  /** Nameplate IT power draw per server at 100 % utilisation, watts. */
  ratedPowerWattsPerServer: number
  /**
   * Fraction of rated power a server draws at 0 % utilisation. Real servers
   * idle at roughly 0.4–0.6 of peak; this is the model's linear-interpolation
   * floor, not a measurement.
   */
  idlePowerFraction: number
  /** Mean CPU utilisation across the fleet, 0–100 %. */
  utilisationPercent: number
  /**
   * Cooling and distribution overhead as a fraction of IT load. 0.5 means the
   * facility spends 0.5 kWh on cooling, UPS losses and lighting for every
   * 1 kWh the IT equipment draws — i.e. PUE 1.5.
   */
  coolingOverheadFraction: number
  /** Share of facility electricity from zero-carbon generation, 0–100 %. */
  renewablePercent: number
  /**
   * Carbon intensity of the non-renewable share of the grid, gCO₂e/kWh.
   * Varies hugely by region; the user sets it, we never guess it.
   */
  gridCarbonIntensityGramsPerKwh: number
  /** Electricity price, for the cost line. Currency is the user's own. */
  electricityPricePerKwh: number
}

export const DEFAULT_ENERGY_INPUTS: EnergyInputs = {
  serverCount: 500,
  // Representative of a 2U dual-socket server. Set to your own hardware.
  ratedPowerWattsPerServer: 450,
  idlePowerFraction: 0.5,
  utilisationPercent: 45,
  // 0.5 → PUE 1.5, close to the industry average reported in the Uptime
  // Institute's annual survey. Users running a modern facility should lower it.
  coolingOverheadFraction: 0.5,
  renewablePercent: 30,
  // Roughly a mixed fossil-and-renewable grid. Regional values range from
  // under 50 (Nordic hydro) to over 700 (coal-dominated).
  gridCarbonIntensityGramsPerKwh: 450,
  electricityPricePerKwh: 0.12,
}

/** Each input, with the bounds and provenance the UI shows beside its slider. */
export const INPUT_METADATA: Record<
  keyof EnergyInputs,
  { label: string; unit: string; min: number; max: number; step: number; note: string }
> = {
  serverCount: {
    label: 'Server count',
    unit: 'servers',
    min: 10,
    max: 5000,
    step: 10,
    note: 'Size of the modelled fleet. Scales IT load linearly.',
  },
  ratedPowerWattsPerServer: {
    label: 'Rated IT power per server',
    unit: 'W',
    min: 100,
    max: 1200,
    step: 10,
    note: 'Nameplate draw at full load. Read it off your hardware; do not accept this default as fact.',
  },
  idlePowerFraction: {
    label: 'Idle power fraction',
    unit: '× rated',
    min: 0.2,
    max: 0.9,
    step: 0.05,
    note: 'Power at 0 % utilisation as a fraction of rated. The model interpolates linearly between idle and rated.',
  },
  utilisationPercent: {
    label: 'Mean fleet utilisation',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    note: 'Average CPU utilisation across the fleet.',
  },
  coolingOverheadFraction: {
    label: 'Cooling & distribution overhead',
    unit: '× IT load',
    min: 0.02,
    max: 1.5,
    step: 0.01,
    note: 'Non-IT facility energy per unit of IT energy. This is what sets PUE: PUE = 1 + this value.',
  },
  renewablePercent: {
    label: 'Renewable supply share',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    note: 'Share of facility electricity treated as zero-carbon at the point of use.',
  },
  gridCarbonIntensityGramsPerKwh: {
    label: 'Grid carbon intensity',
    unit: 'gCO₂e/kWh',
    min: 10,
    max: 900,
    step: 5,
    note: 'Carbon intensity of the non-renewable share. Regional; look up your own grid operator.',
  },
  electricityPricePerKwh: {
    label: 'Electricity price',
    unit: 'per kWh',
    min: 0.02,
    max: 0.6,
    step: 0.01,
    note: 'Your tariff, in your own currency. Only affects the cost line.',
  },
}

export interface EnergyResult {
  /** Instantaneous IT power draw at the stated utilisation, kW. */
  itPowerKw: number
  /** Cooling and distribution power, kW. */
  overheadPowerKw: number
  /** Total facility power, kW. */
  totalFacilityPowerKw: number
  /** PUE = total facility energy / IT equipment energy. */
  pue: number
  /** Annualised energy, assuming the modelled load runs continuously. */
  itEnergyMwhPerYear: number
  totalEnergyMwhPerYear: number
  /** Energy drawn from the non-renewable share, MWh/yr. */
  fossilEnergyMwhPerYear: number
  /** Operational emissions, tonnes CO₂e per year. */
  emissionsTonnesCo2ePerYear: number
  /** Annual electricity cost, in the user's currency. */
  annualCost: number
  /** Per-server mean draw at this utilisation, watts. */
  perServerWatts: number
  /** Watts of overhead avoided per watt of IT load vs. a PUE 2.0 baseline. */
  savingsVsPue2Kw: number
}

/**
 * Linear interpolation between idle and rated power. Real server power curves
 * are mildly non-linear; this model states its simplification rather than
 * implying measurement-grade fidelity.
 */
export function serverPowerWatts(inputs: EnergyInputs): number {
  const { ratedPowerWattsPerServer, idlePowerFraction, utilisationPercent } = inputs
  const idle = ratedPowerWattsPerServer * idlePowerFraction
  const span = ratedPowerWattsPerServer - idle
  return idle + span * (Math.min(Math.max(utilisationPercent, 0), 100) / 100)
}

export function computeEnergy(inputs: EnergyInputs): EnergyResult {
  const perServerWatts = serverPowerWatts(inputs)
  const itPowerKw = (perServerWatts * inputs.serverCount) / 1000
  const overheadPowerKw = itPowerKw * inputs.coolingOverheadFraction
  const totalFacilityPowerKw = itPowerKw + overheadPowerKw

  // PUE = total / IT. With overhead modelled as a fraction of IT load, this
  // reduces exactly to 1 + overheadFraction — shown in the UI as a check.
  const pue = itPowerKw > 0 ? totalFacilityPowerKw / itPowerKw : 1

  const hoursPerYear = 8760
  const itEnergyMwhPerYear = (itPowerKw * hoursPerYear) / 1000
  const totalEnergyMwhPerYear = (totalFacilityPowerKw * hoursPerYear) / 1000

  const fossilShare = 1 - Math.min(Math.max(inputs.renewablePercent, 0), 100) / 100
  const fossilEnergyMwhPerYear = totalEnergyMwhPerYear * fossilShare

  // g/kWh × MWh × 1000 kWh/MWh = g; ÷ 1e6 = tonnes.
  const emissionsTonnesCo2ePerYear =
    (fossilEnergyMwhPerYear * 1000 * inputs.gridCarbonIntensityGramsPerKwh) / 1_000_000

  return {
    itPowerKw,
    overheadPowerKw,
    totalFacilityPowerKw,
    pue,
    itEnergyMwhPerYear,
    totalEnergyMwhPerYear,
    fossilEnergyMwhPerYear,
    emissionsTonnesCo2ePerYear,
    annualCost: totalEnergyMwhPerYear * 1000 * inputs.electricityPricePerKwh,
    perServerWatts,
    savingsVsPue2Kw: itPowerKw * (2 - pue),
  }
}

/** The formula chain, rendered so a reader can verify the arithmetic. */
export function explainCalculation(inputs: EnergyInputs, result: EnergyResult): string[] {
  const r = (n: number, d = 2) => n.toFixed(d)
  return [
    `Per-server power = idle + (rated − idle) × utilisation = ${r(inputs.ratedPowerWattsPerServer * inputs.idlePowerFraction, 0)} W + ${r(inputs.ratedPowerWattsPerServer - inputs.ratedPowerWattsPerServer * inputs.idlePowerFraction, 0)} W × ${inputs.utilisationPercent}% = ${r(result.perServerWatts, 0)} W`,
    `IT power = ${r(result.perServerWatts, 0)} W × ${inputs.serverCount} servers = ${r(result.itPowerKw, 1)} kW`,
    `Overhead = IT power × ${inputs.coolingOverheadFraction} = ${r(result.overheadPowerKw, 1)} kW`,
    `PUE = total ÷ IT = ${r(result.totalFacilityPowerKw, 1)} ÷ ${r(result.itPowerKw, 1)} = ${r(result.pue, 3)}`,
    `Annual energy = ${r(result.totalFacilityPowerKw, 1)} kW × 8760 h = ${r(result.totalEnergyMwhPerYear, 1)} MWh`,
    `Non-renewable share = ${r(result.totalEnergyMwhPerYear, 1)} MWh × ${100 - inputs.renewablePercent}% = ${r(result.fossilEnergyMwhPerYear, 1)} MWh`,
    `Emissions = ${r(result.fossilEnergyMwhPerYear, 1)} MWh × ${inputs.gridCarbonIntensityGramsPerKwh} gCO₂e/kWh = ${r(result.emissionsTonnesCo2ePerYear, 1)} tCO₂e/yr`,
  ]
}

/** The assumptions a reader must accept for the output to mean anything. */
export const MODEL_ASSUMPTIONS: string[] = [
  'The modelled load runs continuously for 8760 hours a year. Real fleets have diurnal and seasonal variation.',
  'Server power is interpolated linearly between idle and rated draw. Real power curves are non-linear.',
  'Cooling and distribution overhead is a fixed fraction of IT load. In reality it varies with outside air temperature and part-load efficiency.',
  'Renewable supply is treated as zero-carbon at the point of use. It does not account for embodied generation emissions, curtailment, or the difference between contractual and physical supply.',
  'Grid carbon intensity is a single annual average. Real intensity swings hourly with the generation mix.',
  'Embodied carbon from manufacturing and disposing of the hardware is excluded entirely. For many facilities that is a large share of lifetime emissions.',
]
