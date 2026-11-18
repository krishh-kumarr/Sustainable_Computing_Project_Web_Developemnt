/**
 * Zero-dimensional energy-balance climate model.
 *
 * What this is: the standard textbook one-box model. CO₂ concentration gives a
 * radiative forcing through the Myhre logarithmic fit; forcing drives a single
 * well-mixed heat reservoir against a linear feedback.
 *
 * What this is NOT: a general circulation model, and emphatically not CMIP6.
 * It has no spatial structure, no ocean circulation, no atmospheric dynamics
 * and no regional detail. It reproduces the *global-mean transient response*
 * to a forcing change and nothing else. Everything it produces is labelled
 * ILLUSTRATIVE SCENARIO in the interface.
 *
 * References:
 *   Myhre et al. (1998), GRL 25(14) — the 5.35·ln(C/C₀) forcing fit.
 *   IPCC AR6 WG1 Ch.7 — feedback parameter and effective heat capacity ranges.
 */

/** Pre-industrial CO₂ concentration, ppm. The forcing reference. */
export const CO2_PREINDUSTRIAL_PPM = 278

/**
 * Myhre coefficient, W/m² per natural log of the concentration ratio.
 * ΔF = 5.35 · ln(C / C₀)
 */
export const MYHRE_COEFFICIENT = 5.35

/**
 * Climate feedback parameter, W/m²/K. Equilibrium sensitivity follows as
 * ECS = F_2x / λ. With F_2x = 3.71 W/m², λ = 1.3 gives ECS ≈ 2.85 K, inside
 * the AR6 likely range of 2.5–4 K.
 */
export const FEEDBACK_PARAMETER = 1.3

/**
 * Effective heat capacity of the climate system, W·yr/m²/K. Corresponds to a
 * well-mixed ocean layer of roughly 70 m. The deep ocean is not represented,
 * so this model warms faster toward equilibrium than the real system does.
 */
export const HEAT_CAPACITY = 8.5

/** Radiative forcing of a CO₂ concentration relative to pre-industrial. */
export function co2Forcing(concentrationPpm: number): number {
  const c = Math.max(concentrationPpm, 1)
  return MYHRE_COEFFICIENT * Math.log(c / CO2_PREINDUSTRIAL_PPM)
}

/** Forcing for doubled CO₂ — the conventional sensitivity benchmark. */
export const FORCING_2X_CO2 = MYHRE_COEFFICIENT * Math.LN2

/** Equilibrium climate sensitivity implied by the feedback parameter, K. */
export const EQUILIBRIUM_SENSITIVITY = FORCING_2X_CO2 / FEEDBACK_PARAMETER

/**
 * One Euler step of the one-box model.
 *
 *   C · dT/dt = F − λ·T
 *
 * @param temperatureAnomalyK Current anomaly above the forcing reference, K.
 * @param forcingWm2 Total radiative forcing, W/m².
 * @param years Step length in years.
 */
export function stepEnergyBalance(
  temperatureAnomalyK: number,
  forcingWm2: number,
  years: number,
): number {
  const dTdt = (forcingWm2 - FEEDBACK_PARAMETER * temperatureAnomalyK) / HEAT_CAPACITY
  return temperatureAnomalyK + dTdt * years
}

/**
 * Additional forcing from a change in planetary albedo, e.g. a cloud-cover
 * assumption. ΔF = −S/4 · Δα, with the solar constant S = 1361 W/m².
 *
 * Cloud feedback is the single largest uncertainty in real climate models; this
 * linear term is a teaching device, not a representation of that physics.
 */
export const SOLAR_CONSTANT = 1361

export function albedoForcing(albedoChange: number): number {
  return -(SOLAR_CONSTANT / 4) * albedoChange
}

/**
 * Forcing from a fractional change in incident solar irradiance.
 * ΔF = (S/4)·(1 − α)·(ΔS/S), with planetary albedo α = 0.30.
 */
export const PLANETARY_ALBEDO = 0.3

export function solarForcing(fractionalChange: number): number {
  return (SOLAR_CONSTANT / 4) * (1 - PLANETARY_ALBEDO) * fractionalChange
}

/**
 * Hydrological sensitivity: global-mean precipitation rises roughly 2–3 % per
 * kelvin of global warming, constrained by the atmospheric energy budget
 * rather than by moisture availability (which would give ~7 %/K).
 * AR6 WG1 Ch.8 puts the range at 1–3 %/K; 2 %/K is used here.
 */
export const PRECIPITATION_SENSITIVITY_PER_K = 0.02

export function precipitationScaleFor(temperatureAnomalyK: number): number {
  return 1 + PRECIPITATION_SENSITIVITY_PER_K * temperatureAnomalyK
}

/**
 * Clausius-Clapeyron: saturation vapour pressure rises ~7 %/K. Governs
 * atmospheric moisture capacity, and therefore extreme-rainfall intensity,
 * even where mean precipitation changes much less.
 */
export const CLAUSIUS_CLAPEYRON_PER_K = 0.07

/** Saturation vapour pressure, kPa (FAO-56 eq. 11, Tetens form). */
export function saturationVapourPressure(temperatureC: number): number {
  return 0.6108 * Math.exp((17.27 * temperatureC) / (temperatureC + 237.3))
}

/** Documented CO₂ pathways. Concentrations are illustrative, not projections. */
export interface Co2Pathway {
  id: number
  label: string
  /** ppm at the start of the run. */
  startPpm: number
  /** ppm per year of change. */
  ppmPerYear: number
  note: string
}

export const CO2_PATHWAYS: Co2Pathway[] = [
  {
    id: 0,
    label: 'Concentration held constant',
    startPpm: 422,
    ppmPerYear: 0,
    note: 'Holds CO₂ at roughly its present observed concentration. Shows the warming still in the pipeline from forcing already applied.',
  },
  {
    id: 1,
    label: 'Continued growth, ~2.4 ppm/yr',
    startPpm: 422,
    ppmPerYear: 2.4,
    note: 'Extends the recent observed Mauna Loa growth rate linearly. A trend extension, not a projection.',
  },
  {
    id: 2,
    label: 'Accelerating, ~3.5 ppm/yr',
    startPpm: 422,
    ppmPerYear: 3.5,
    note: 'A higher-emissions illustrative pathway.',
  },
  {
    id: 3,
    label: 'Growth slowing to zero',
    startPpm: 422,
    ppmPerYear: 1.0,
    note: 'A mitigation-flavoured illustrative pathway with much slower accumulation.',
  },
  {
    id: 4,
    label: 'Declining concentration',
    startPpm: 422,
    ppmPerYear: -0.8,
    note: 'Assumes net removal exceeds emissions. Included to show the model is symmetric, not because it is likely.',
  },
]

export function pathwayById(id: number): Co2Pathway {
  return CO2_PATHWAYS.find((pathway) => pathway.id === id) ?? CO2_PATHWAYS[0]
}
