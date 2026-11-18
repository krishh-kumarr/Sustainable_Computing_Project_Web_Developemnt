/**
 * Water-balance physics shared by AquaGuard and AgriFuture.
 *
 * Two distinct balances live here:
 *
 *  1. A **reservoir** balance — a lumped storage accounting identity:
 *         ΔS = (inflow − outflow) · Δt
 *     with inflow from catchment runoff and outflow from release, demand,
 *     evaporation, seepage and spill. This is bookkeeping on a single bucket.
 *     It is not a hydraulic model: it has no routing, no channel geometry, no
 *     momentum and no floodplain. It cannot tell you where water goes, only
 *     how much of it there is.
 *
 *  2. A **soil** balance — FAO-56 Irrigation and Drainage Paper 56, which is a
 *     published, widely used method for crop water requirement. Implemented
 *     here with the water-stress coefficient, which the Phase 1 static version
 *     did not include.
 *
 * Reference: Allen, Pereira, Raes & Smith (1998), FAO-56.
 * https://www.fao.org/4/x0490e/x0490e00.htm
 */

// ── Reservoir ──────────────────────────────────────────────────────────────

export interface ReservoirGeometry {
  /** Usable storage at full supply level, million cubic metres (Mm³). */
  capacityMcm: number
  /** Water-surface area at full supply level, km². */
  surfaceAreaAtFullKm2: number
  /** Depth at full supply level, metres. */
  depthAtFullM: number
  /**
   * Stage–storage exponent. S/S_max = (h/h_max)^b. b = 1 is a vertical-walled
   * tank; real reservoirs in valleys run roughly 1.5–2.5 because surface area
   * shrinks as the level falls. 2.0 is used as a documented default.
   */
  stageStorageExponent: number
}

/** Water level implied by a storage volume, metres above the dead-storage base. */
export function levelFromStorage(storageMcm: number, geometry: ReservoirGeometry): number {
  if (geometry.capacityMcm <= 0) return 0
  const fraction = Math.min(Math.max(storageMcm / geometry.capacityMcm, 0), 1.2)
  return geometry.depthAtFullM * Math.pow(fraction, 1 / geometry.stageStorageExponent)
}

/** Water-surface area at a given storage, km². Shrinks as the level falls. */
export function surfaceAreaFromStorage(storageMcm: number, geometry: ReservoirGeometry): number {
  if (geometry.capacityMcm <= 0) return 0
  const fraction = Math.min(Math.max(storageMcm / geometry.capacityMcm, 0), 1)
  // Area scales as the square of the linear dimension while depth scales
  // linearly, consistent with the stage-storage exponent above.
  const exponent = (geometry.stageStorageExponent - 1) / geometry.stageStorageExponent
  return geometry.surfaceAreaAtFullKm2 * Math.pow(fraction, Math.max(exponent, 0))
}

/**
 * Catchment runoff from rainfall, using the rational runoff-coefficient method.
 *
 *   Q = C · P · A
 *
 * C is the runoff coefficient: the fraction of rainfall reaching the channel
 * rather than infiltrating or evaporating. It is a lumped empirical constant
 * covering soil, slope, land cover and antecedent wetness — the single
 * crudest assumption in this model.
 *
 * @returns Volume in million cubic metres.
 */
export function catchmentRunoffMcm(
  rainfallMm: number,
  catchmentAreaKm2: number,
  runoffCoefficient: number,
): number {
  // mm × km² = 1000 m³; ÷ 1e6 to reach Mm³.
  return (rainfallMm * catchmentAreaKm2 * runoffCoefficient * 1000) / 1_000_000
}

/**
 * Open-water evaporation, mm/day, from a temperature-dependent rate.
 *
 * A deliberately simple parameterisation: a base rate at 20 °C scaled by the
 * Clausius-Clapeyron-like sensitivity of evaporative demand. A real estimate
 * would use Penman with radiation, humidity and wind; this is the lever the
 * shared temperature anomaly acts through, and it is labelled as a model term.
 */
export const EVAPORATION_BASE_MM_PER_DAY = 4.0
export const EVAPORATION_SENSITIVITY_PER_K = 0.06

export function evaporationRateMmPerDay(temperatureC: number): number {
  return Math.max(
    EVAPORATION_BASE_MM_PER_DAY * (1 + EVAPORATION_SENSITIVITY_PER_K * (temperatureC - 20)),
    0,
  )
}

export interface ReservoirStep {
  /** Storage after the step, Mm³. */
  storageMcm: number
  /** Each flux over the step, Mm³, so the balance can be audited. */
  fluxes: {
    rainfallInflow: number
    baseInflow: number
    release: number
    demand: number
    evaporation: number
    seepage: number
    spill: number
  }
  /** True when storage hit the capacity and water was spilled. */
  spilled: boolean
  /** True when storage hit zero and demand could not be met. */
  depleted: boolean
  /** Demand that could not be supplied this step, Mm³. */
  unmetDemandMcm: number
}

export interface ReservoirInputs {
  rainfallMm: number
  catchmentAreaKm2: number
  runoffCoefficient: number
  /** Baseflow entering independently of this step's rainfall, m³/s. */
  baseInflowCumecs: number
  /** Controlled release through the outlet works, m³/s. */
  releaseCumecs: number
  /** Abstraction for supply, Mm³ per day. */
  dailyDemandMcm: number
  /** Fraction of demand actually delivered; the rest is distribution loss. */
  distributionEfficiency: number
  temperatureC: number
  /** Fraction of storage lost to seepage per day. */
  seepageFractionPerDay: number
}

/**
 * Advance the reservoir balance by `days`.
 *
 * Fluxes are applied simultaneously over the step, then storage is clipped to
 * [0, capacity] with the excess reported as spill and the shortfall as unmet
 * demand — rather than letting storage go negative, which would silently
 * fabricate water.
 */
export function stepReservoir(
  storageMcm: number,
  geometry: ReservoirGeometry,
  inputs: ReservoirInputs,
  days: number,
): ReservoirStep {
  const secondsPerDay = 86_400
  const cumecsToMcmPerDay = (secondsPerDay * days) / 1_000_000

  const rainfallInflow = catchmentRunoffMcm(
    inputs.rainfallMm * days,
    inputs.catchmentAreaKm2,
    inputs.runoffCoefficient,
  )
  const baseInflow = inputs.baseInflowCumecs * cumecsToMcmPerDay
  const release = inputs.releaseCumecs * cumecsToMcmPerDay

  const surfaceAreaKm2 = surfaceAreaFromStorage(storageMcm, geometry)
  const evaporation =
    (evaporationRateMmPerDay(inputs.temperatureC) * days * surfaceAreaKm2 * 1000) / 1_000_000

  const seepage = storageMcm * inputs.seepageFractionPerDay * days

  // Distribution losses mean more must leave storage than reaches the user.
  const efficiency = Math.min(Math.max(inputs.distributionEfficiency, 0.1), 1)
  const demand = (inputs.dailyDemandMcm * days) / efficiency

  const inflow = rainfallInflow + baseInflow
  const outflow = release + demand + evaporation + seepage

  let next = storageMcm + inflow - outflow
  let spill = 0
  let unmetDemandMcm = 0

  if (next > geometry.capacityMcm) {
    spill = next - geometry.capacityMcm
    next = geometry.capacityMcm
  }
  if (next < 0) {
    // The deficit is demand that could not be met, not negative water.
    unmetDemandMcm = Math.min(-next, demand)
    next = 0
  }

  return {
    storageMcm: next,
    fluxes: { rainfallInflow, baseInflow, release, demand, evaporation, seepage, spill },
    spilled: spill > 0,
    depleted: next <= 0,
    unmetDemandMcm,
  }
}

// ── Soil water (FAO-56) ────────────────────────────────────────────────────

export const FAO56 = {
  citation: 'FAO Irrigation and Drainage Paper 56, Allen et al. (1998)',
  url: 'https://www.fao.org/4/x0490e/x0490e00.htm',
} as const

export interface SoilProfile {
  /** Volumetric water content at field capacity, m³/m³. */
  fieldCapacity: number
  /** Volumetric water content at permanent wilting point, m³/m³. */
  wiltingPoint: number
  /** Effective rooting depth, metres. */
  rootingDepthM: number
  /**
   * Depletion fraction p: the share of total available water a crop can use
   * before transpiration becomes limited. FAO-56 Table 22; ~0.5 for most
   * field crops at moderate demand.
   */
  depletionFraction: number
}

/** Total available water in the root zone, mm. TAW = 1000·(θ_FC − θ_WP)·Zr */
export function totalAvailableWaterMm(soil: SoilProfile): number {
  return 1000 * (soil.fieldCapacity - soil.wiltingPoint) * soil.rootingDepthM
}

/** Readily available water, mm. RAW = p · TAW */
export function readilyAvailableWaterMm(soil: SoilProfile): number {
  return soil.depletionFraction * totalAvailableWaterMm(soil)
}

/**
 * Water-stress coefficient Ks (FAO-56 eq. 84).
 *
 *   Ks = (TAW − Dr) / (TAW − RAW)   when Dr > RAW
 *   Ks = 1                           otherwise
 *
 * This is the piece that makes the simulation respond to irrigation: once
 * depletion passes RAW, the crop cannot transpire at its potential rate, so
 * actual water use falls below demand and the plant is under stress.
 */
export function stressCoefficient(depletionMm: number, soil: SoilProfile): number {
  const taw = totalAvailableWaterMm(soil)
  const raw = readilyAvailableWaterMm(soil)
  if (depletionMm <= raw) return 1
  if (taw <= raw) return 0
  return Math.min(Math.max((taw - depletionMm) / (taw - raw), 0), 1)
}

export interface SoilWaterStep {
  /** Root-zone depletion after the step, mm below field capacity. */
  depletionMm: number
  /** Volumetric water content implied by that depletion, m³/m³. */
  volumetricWaterContent: number
  /** Potential crop evapotranspiration, Kc·ET₀, mm. */
  etcMm: number
  /** Actual crop evapotranspiration after stress, Ks·Kc·ET₀, mm. */
  etcAdjustedMm: number
  /** Stress coefficient applied this step. */
  ks: number
  /** Rainfall that reached the root zone, mm. */
  effectiveRainfallMm: number
  /** Water lost below the root zone, mm. */
  deepPercolationMm: number
  /** Irrigation delivered to the root zone, mm. */
  netIrrigationMm: number
}

export interface SoilWaterInputs {
  /** Reference evapotranspiration for the step, mm. */
  et0Mm: number
  /** Crop coefficient for the current growth stage. */
  kc: number
  rainfallMm: number
  /** Fraction of rainfall reaching the root zone. */
  effectiveRainfallFraction: number
  /** Irrigation applied at the field gate, mm. */
  appliedIrrigationMm: number
  /** Fraction of applied irrigation reaching the root zone. */
  applicationEfficiency: number
}

/**
 * Advance the root-zone water balance by one step (FAO-56 §8.4).
 *
 *   Dr,i = Dr,i−1 − (P_eff + I) + ETc,adj + DP
 *
 * Depletion is clipped at zero: water in excess of field capacity drains
 * below the root zone rather than being stored, and that drainage is reported
 * so the loss is visible rather than silently discarded.
 */
export function stepSoilWater(
  depletionMm: number,
  soil: SoilProfile,
  inputs: SoilWaterInputs,
): SoilWaterStep {
  const ks = stressCoefficient(depletionMm, soil)
  const etcMm = inputs.kc * inputs.et0Mm
  const etcAdjustedMm = ks * etcMm

  const effectiveRainfallMm = inputs.rainfallMm * inputs.effectiveRainfallFraction
  const netIrrigationMm = inputs.appliedIrrigationMm * inputs.applicationEfficiency

  let next = depletionMm - (effectiveRainfallMm + netIrrigationMm) + etcAdjustedMm
  let deepPercolationMm = 0
  if (next < 0) {
    deepPercolationMm = -next
    next = 0
  }
  const taw = totalAvailableWaterMm(soil)
  // Depletion cannot exceed total available water: below the wilting point the
  // remaining water is not extractable.
  next = Math.min(next, taw)

  const volumetricWaterContent =
    soil.fieldCapacity - next / (1000 * Math.max(soil.rootingDepthM, 0.01))

  return {
    depletionMm: next,
    volumetricWaterContent: Math.max(volumetricWaterContent, soil.wiltingPoint),
    etcMm,
    etcAdjustedMm,
    ks,
    effectiveRainfallMm,
    deepPercolationMm,
    netIrrigationMm,
  }
}

/** Soil textures, with FAO-56 Table 19 water-holding properties. */
export const SOIL_TEXTURES: { id: number; label: string; profile: Omit<SoilProfile, 'rootingDepthM' | 'depletionFraction'>; note: string }[] = [
  {
    id: 0,
    label: 'Sand',
    profile: { fieldCapacity: 0.12, wiltingPoint: 0.05 },
    note: 'FAO-56 Table 19. Low holding capacity: drains fast and needs frequent, small irrigations.',
  },
  {
    id: 1,
    label: 'Sandy loam',
    profile: { fieldCapacity: 0.21, wiltingPoint: 0.1 },
    note: 'FAO-56 Table 19, midpoint of the published range.',
  },
  {
    id: 2,
    label: 'Loam',
    profile: { fieldCapacity: 0.29, wiltingPoint: 0.14 },
    note: 'FAO-56 Table 19. The reference texture for most irrigation planning.',
  },
  {
    id: 3,
    label: 'Clay loam',
    profile: { fieldCapacity: 0.35, wiltingPoint: 0.19 },
    note: 'FAO-56 Table 19. Holds more water but releases it less readily.',
  },
  {
    id: 4,
    label: 'Clay',
    profile: { fieldCapacity: 0.4, wiltingPoint: 0.24 },
    note: 'FAO-56 Table 19. High total water, high unavailable fraction.',
  },
]

export function soilTextureById(id: number) {
  return SOIL_TEXTURES.find((texture) => texture.id === id) ?? SOIL_TEXTURES[2]
}

/**
 * Growing degree days for the step, with a base temperature below which
 * development effectively stops. GDD tracks phenological progress; it says
 * nothing about yield, and this platform makes no yield claim.
 */
export function growingDegreeDays(meanTemperatureC: number, baseTemperatureC: number, days: number): number {
  return Math.max(meanTemperatureC - baseTemperatureC, 0) * days
}
