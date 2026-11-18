/**
 * AgriFuture data: weather with soil moisture, plus NASA POWER solar.
 *
 * Includes a reference-evapotranspiration-based irrigation estimate. That is a
 * water-balance calculation with stated assumptions, not a yield prediction —
 * the module makes no yield claim at all, because no validated crop model is
 * implemented.
 */

import { useMemo } from 'react'
import type { DailySeries, ForecastBundle } from '../api/openMeteo'

/**
 * FAO-56 single-crop-coefficient irrigation requirement.
 *
 * Net irrigation = Kc × ET₀ − effective rainfall
 *
 * ET₀ is Open-Meteo's own FAO-56 Penman-Monteith reference evapotranspiration,
 * so the reference calculation is the provider's, not ours. Kc and the
 * effective-rainfall fraction are the user's inputs, and both are crop- and
 * soil-specific. Reference: FAO Irrigation and Drainage Paper 56.
 */
export const FAO56 = {
  citation: 'FAO Irrigation and Drainage Paper 56, Allen et al. (1998)',
  url: 'https://www.fao.org/4/x0490e/x0490e00.htm',
} as const

/**
 * Mid-season crop coefficients from FAO-56 Table 12. These are the published
 * reference values; actual Kc varies with growth stage, planting density and
 * local climate, which is why the UI lets the user change it.
 */
export const CROP_COEFFICIENTS: { crop: string; kcMid: number; note: string }[] = [
  { crop: 'Rice (paddy)', kcMid: 1.2, note: 'FAO-56 Table 12. Excludes percolation losses, which dominate in puddled paddy.' },
  { crop: 'Wheat', kcMid: 1.15, note: 'FAO-56 Table 12, winter wheat mid-season.' },
  { crop: 'Maize (grain)', kcMid: 1.2, note: 'FAO-56 Table 12, field maize mid-season.' },
  { crop: 'Cotton', kcMid: 1.175, note: 'FAO-56 Table 12, mid-season midpoint of the published 1.15–1.20 range.' },
  { crop: 'Sugarcane', kcMid: 1.25, note: 'FAO-56 Table 12, mid-season.' },
  { crop: 'Tomato (field)', kcMid: 1.15, note: 'FAO-56 Table 12, mid-season.' },
  { crop: 'Reference grass (Kc = 1)', kcMid: 1.0, note: 'The ET₀ reference surface itself — a baseline, not a crop.' },
]

export interface IrrigationInputs {
  /** Crop coefficient for the current growth stage. */
  kc: number
  /**
   * Fraction of rainfall that reaches the root zone rather than running off or
   * evaporating. Depends on soil, slope and rainfall intensity.
   */
  effectiveRainfallFraction: number
  /** Irrigation system application efficiency, 0–1. */
  applicationEfficiency: number
}

export const DEFAULT_IRRIGATION_INPUTS: IrrigationInputs = {
  kc: 1.15,
  // 0.75 is a common planning assumption for moderate-intensity rainfall on
  // level ground. It is an assumption, not a measurement.
  effectiveRainfallFraction: 0.75,
  // 0.75 is typical of well-managed surface irrigation; drip reaches ~0.9.
  applicationEfficiency: 0.75,
}

export interface IrrigationDay {
  date: string
  /** Reference evapotranspiration from the provider, mm/day. */
  et0: number | null
  /** Kc × ET₀, mm/day. */
  cropWaterDemand: number | null
  /** Total rainfall, mm/day. */
  rainfall: number | null
  /** Rainfall × effective fraction, mm/day. */
  effectiveRainfall: number | null
  /** Net requirement before system losses, mm/day. Floored at zero. */
  netIrrigation: number | null
  /** Net ÷ application efficiency — what must actually be delivered, mm/day. */
  grossIrrigation: number | null
}

export interface IrrigationEstimate {
  days: IrrigationDay[]
  /** Totals over the days that had an ET₀ value. */
  totals: {
    cropWaterDemandMm: number
    effectiveRainfallMm: number
    netIrrigationMm: number
    grossIrrigationMm: number
    /** Gross requirement expressed as litres per hectare over the period. */
    grossLitresPerHectare: number
    dayCount: number
  } | null
  /** Days with no ET₀ value from the provider, excluded from the totals. */
  missingDays: number
}

export function estimateIrrigation(daily: DailySeries[], inputs: IrrigationInputs): IrrigationEstimate {
  const days: IrrigationDay[] = daily.map((row) => {
    const et0 = row.et0
    const rainfall = row.precipitationSum
    if (et0 === null) {
      return {
        date: row.date,
        et0: null,
        cropWaterDemand: null,
        rainfall,
        effectiveRainfall: rainfall === null ? null : rainfall * inputs.effectiveRainfallFraction,
        netIrrigation: null,
        grossIrrigation: null,
      }
    }
    const cropWaterDemand = inputs.kc * et0
    const effectiveRainfall = (rainfall ?? 0) * inputs.effectiveRainfallFraction
    // A surplus does not carry forward: this is a daily balance, and soil
    // storage is not modelled.
    const netIrrigation = Math.max(cropWaterDemand - effectiveRainfall, 0)
    return {
      date: row.date,
      et0,
      cropWaterDemand,
      rainfall,
      effectiveRainfall,
      netIrrigation,
      grossIrrigation: netIrrigation / inputs.applicationEfficiency,
    }
  })

  const valid = days.filter((d) => d.et0 !== null)
  const totals =
    valid.length > 0
      ? {
          cropWaterDemandMm: valid.reduce((s, d) => s + (d.cropWaterDemand ?? 0), 0),
          effectiveRainfallMm: valid.reduce((s, d) => s + (d.effectiveRainfall ?? 0), 0),
          netIrrigationMm: valid.reduce((s, d) => s + (d.netIrrigation ?? 0), 0),
          grossIrrigationMm: valid.reduce((s, d) => s + (d.grossIrrigation ?? 0), 0),
          // 1 mm over 1 hectare = 10 000 litres.
          grossLitresPerHectare: valid.reduce((s, d) => s + (d.grossIrrigation ?? 0), 0) * 10_000,
          dayCount: valid.length,
        }
      : null

  return { days, totals, missingDays: days.length - valid.length }
}

export function useIrrigationEstimate(
  bundle: ForecastBundle | null,
  inputs: IrrigationInputs,
): IrrigationEstimate | null {
  return useMemo(() => {
    if (!bundle || bundle.daily.length === 0) return null
    return estimateIrrigation(bundle.daily, inputs)
  }, [bundle, inputs])
}

export const IRRIGATION_ASSUMPTIONS: string[] = [
  'ET₀ is the provider\'s FAO-56 Penman-Monteith reference evapotranspiration for a short grass reference surface.',
  'Kc is taken from FAO-56 Table 12 for the mid-season stage. Early and late stages need lower values, so a season-long figure using mid-season Kc over-estimates total demand.',
  'The effective-rainfall fraction and application efficiency are planning assumptions the user sets, not site measurements.',
  'Soil water storage, capillary rise, deep percolation and groundwater contribution are all excluded. A daily surplus does not carry into the next day.',
  'This is a water-balance estimate, not a yield prediction. No crop growth model is implemented, so the module makes no yield claim.',
]

/**
 * Soil moisture comes from Open-Meteo's 0–7 cm layer as a volumetric fraction
 * (m³ water per m³ soil). Interpreting it needs the soil's own field capacity
 * and wilting point, which we do not have for an arbitrary point, so the UI
 * shows the raw fraction and these reference bands rather than a
 * "% of available water" figure that would imply knowledge we lack.
 */
export const SOIL_MOISTURE_BANDS: { label: string; upper: number; note: string }[] = [
  { label: 'Very dry', upper: 0.1, note: 'Below the wilting point of most mineral soils.' },
  { label: 'Dry', upper: 0.2, note: 'Plant-available water is limited in most soil textures.' },
  { label: 'Moderate', upper: 0.3, note: 'Within the plant-available range for most loams.' },
  { label: 'Moist', upper: 0.4, note: 'Near field capacity for many soils.' },
  { label: 'Saturated', upper: 1, note: 'At or above field capacity; drainage and aeration become limiting.' },
]

export function soilMoistureBand(fraction: number | null): { label: string; note: string } | null {
  if (fraction === null) return null
  const band = SOIL_MOISTURE_BANDS.find((b) => fraction <= b.upper)
  return band ? { label: band.label, note: band.note } : null
}
