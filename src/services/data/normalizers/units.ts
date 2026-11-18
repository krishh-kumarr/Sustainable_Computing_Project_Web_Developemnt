/**
 * Unit handling. The rule across the app: a number is never displayed without
 * the unit the provider actually returned, and conversions are explicit.
 */

export interface Quantity {
  value: number | null
  unit: string
}

export const q = (value: number | null, unit: string): Quantity => ({ value, unit })

/** Open-Meteo returns wind in km/h by default; several panels want m/s. */
export const kmhToMs = (kmh: number): number => kmh / 3.6

/** USGS reports discharge in cubic feet per second. */
export const cfsToCumecs = (cfs: number): number => cfs * 0.028316846592
/** USGS reports gauge height in feet. */
export const feetToMetres = (ft: number): number => ft * 0.3048

/** NASA POWER irradiance comes as MJ/m²/day. kWh/m²/day is the agronomic norm. */
export const mjPerM2DayToKwhPerM2Day = (mj: number): number => mj / 3.6

/** Fire Radiative Power arrives in megawatts. */
export const kelvinToCelsius = (k: number): number => k - 273.15

export function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Format a value with its unit, or an explicit dash when there is no value. */
export function formatQuantity(quantity: Quantity, decimals = 1): string {
  if (quantity.value === null) return '—'
  return `${round(quantity.value, decimals)} ${quantity.unit}`.trim()
}

/** Compact, locale-stable number formatting for large counts. */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${round(n / 1_000_000, 1)}M`
  if (n >= 1_000) return `${round(n / 1_000, 1)}k`
  return String(n)
}
