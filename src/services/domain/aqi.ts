/**
 * US EPA Air Quality Index.
 *
 * Implements the breakpoint table and piecewise-linear formula published in
 * 40 CFR Part 58, Appendix G, as revised in 2024 (the revision that lowered the
 * PM2.5 "Good" ceiling to 9.0 µg/m³). No other index, and no invented formula.
 *
 * Two honesty constraints are built into the return type rather than left to
 * the caller to remember:
 *
 *  1. The standard defines each sub-index over a specific averaging period
 *     (PM: 24 hours, O₃ and CO: 8 hours, NO₂ and SO₂: 1 hour). A monitor's
 *     latest reported value is usually a 1-hour value, so for PM, O₃ and CO the
 *     period does not match. `averagingPeriodMatches` records that, and the UI
 *     must show it.
 *  2. The gaseous breakpoints are defined in ppm/ppb. Converting from the
 *     µg/m³ that OpenAQ usually reports needs an assumed temperature and
 *     pressure. That assumption is stated in `conversionNote`, and when the
 *     unit cannot be converted at all the sub-index is simply not computed.
 *
 * Reference: https://www.airnow.gov/aqi/aqi-basics/ and 40 CFR 58 App. G.
 */

export const AQI_STANDARD = {
  id: 'us-epa-aqi',
  name: 'US EPA Air Quality Index',
  citation: '40 CFR Part 58, Appendix G (2024 revision)',
  url: 'https://www.airnow.gov/aqi/aqi-basics/',
} as const

export interface AqiCategory {
  name: string
  lower: number
  upper: number
  /** Palette tone used for the band, kept inside the editorial scheme. */
  tone: string
  healthStatement: string
}

export const AQI_CATEGORIES: AqiCategory[] = [
  {
    name: 'Good',
    lower: 0,
    upper: 50,
    tone: '#64816C',
    healthStatement: 'Air quality is satisfactory and air pollution poses little or no risk.',
  },
  {
    name: 'Moderate',
    lower: 51,
    upper: 100,
    tone: '#C39A62',
    healthStatement:
      'Acceptable for most. Unusually sensitive people should consider limiting prolonged outdoor exertion.',
  },
  {
    name: 'Unhealthy for Sensitive Groups',
    lower: 101,
    upper: 150,
    tone: '#D97706',
    healthStatement:
      'Members of sensitive groups may experience health effects. The general public is less likely to be affected.',
  },
  {
    name: 'Unhealthy',
    lower: 151,
    upper: 200,
    tone: '#DC2626',
    healthStatement:
      'Some members of the general public may experience health effects; sensitive groups more seriously.',
  },
  {
    name: 'Very Unhealthy',
    lower: 201,
    upper: 300,
    tone: '#9333EA',
    healthStatement: 'Health alert: the risk of health effects is increased for everyone.',
  },
  {
    name: 'Hazardous',
    lower: 301,
    upper: 500,
    tone: '#7F1D1D',
    healthStatement: 'Health warning of emergency conditions: everyone is more likely to be affected.',
  },
]

export function categoryFor(aqi: number): AqiCategory {
  return AQI_CATEGORIES.find((c) => aqi >= c.lower && aqi <= c.upper) ?? AQI_CATEGORIES[AQI_CATEGORIES.length - 1]
}

/** [concentration low, concentration high, index low, index high] */
type Breakpoint = [number, number, number, number]

interface PollutantSpec {
  /** Unit the EPA breakpoints are expressed in. */
  standardUnit: 'ug/m3' | 'ppm' | 'ppb'
  /** Averaging period the standard requires, in hours. */
  averagingHours: number
  /** Molecular weight, for µg/m³ ⇄ ppb conversion. Absent for particulates. */
  molecularWeight?: number
  /** Decimal places the standard truncates the concentration to. */
  truncateTo: number
  breakpoints: Breakpoint[]
}

const SPECS: Record<string, PollutantSpec> = {
  // Particulates: breakpoints already in µg/m³, no conversion needed.
  pm25: {
    standardUnit: 'ug/m3',
    averagingHours: 24,
    truncateTo: 1,
    breakpoints: [
      [0.0, 9.0, 0, 50],
      [9.1, 35.4, 51, 100],
      [35.5, 55.4, 101, 150],
      [55.5, 125.4, 151, 200],
      [125.5, 225.4, 201, 300],
      [225.5, 325.4, 301, 500],
    ],
  },
  pm10: {
    standardUnit: 'ug/m3',
    averagingHours: 24,
    truncateTo: 0,
    breakpoints: [
      [0, 54, 0, 50],
      [55, 154, 51, 100],
      [155, 254, 101, 150],
      [255, 354, 151, 200],
      [355, 424, 201, 300],
      [425, 604, 301, 500],
    ],
  },
  o3: {
    standardUnit: 'ppm',
    averagingHours: 8,
    molecularWeight: 48.0,
    truncateTo: 3,
    breakpoints: [
      [0.0, 0.054, 0, 50],
      [0.055, 0.07, 51, 100],
      [0.071, 0.085, 101, 150],
      [0.086, 0.105, 151, 200],
      [0.106, 0.2, 201, 300],
    ],
  },
  co: {
    standardUnit: 'ppm',
    averagingHours: 8,
    molecularWeight: 28.01,
    truncateTo: 1,
    breakpoints: [
      [0.0, 4.4, 0, 50],
      [4.5, 9.4, 51, 100],
      [9.5, 12.4, 101, 150],
      [12.5, 15.4, 151, 200],
      [15.5, 30.4, 201, 300],
      [30.5, 50.4, 301, 500],
    ],
  },
  no2: {
    standardUnit: 'ppb',
    averagingHours: 1,
    molecularWeight: 46.0055,
    truncateTo: 0,
    breakpoints: [
      [0, 53, 0, 50],
      [54, 100, 51, 100],
      [101, 360, 101, 150],
      [361, 649, 151, 200],
      [650, 1249, 201, 300],
      [1250, 2049, 301, 500],
    ],
  },
  so2: {
    standardUnit: 'ppb',
    averagingHours: 1,
    molecularWeight: 64.066,
    truncateTo: 0,
    breakpoints: [
      [0, 35, 0, 50],
      [36, 75, 51, 100],
      [76, 185, 101, 150],
      [186, 304, 151, 200],
    ],
  },
}

/**
 * Molar volume of an ideal gas at 25 °C and 1 atm, litres per mole. The EPA's
 * own reference conditions for reporting gaseous pollutants.
 */
const MOLAR_VOLUME_25C = 24.45

function normaliseUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s/g, '').replace('µ', 'u').replace('μ', 'u')
}

interface Converted {
  value: number
  note: string | null
}

/** Convert a reported concentration into the unit the breakpoints use. */
function toStandardUnit(value: number, reportedUnit: string, spec: PollutantSpec): Converted | null {
  const unit = normaliseUnit(reportedUnit)
  const isMassPerVolume = unit === 'ug/m3' || unit === 'ug/m^3' || unit === 'ugm3' || unit === 'micrograms/m3'
  const isMgPerVolume = unit === 'mg/m3' || unit === 'mg/m^3'

  if (spec.standardUnit === 'ug/m3') {
    if (isMassPerVolume) return { value, note: null }
    if (isMgPerVolume) return { value: value * 1000, note: 'Reported in mg/m³, scaled to µg/m³.' }
    return null
  }

  // Gaseous pollutant: breakpoints in ppm or ppb.
  const mw = spec.molecularWeight
  if (unit === 'ppm') {
    return { value: spec.standardUnit === 'ppm' ? value : value * 1000, note: null }
  }
  if (unit === 'ppb') {
    return { value: spec.standardUnit === 'ppb' ? value : value / 1000, note: null }
  }
  if ((isMassPerVolume || isMgPerVolume) && mw) {
    const ugPerM3 = isMgPerVolume ? value * 1000 : value
    const ppb = (ugPerM3 * MOLAR_VOLUME_25C) / mw
    return {
      value: spec.standardUnit === 'ppb' ? ppb : ppb / 1000,
      note: `Converted from µg/m³ assuming 25 °C and 1 atm (molar volume ${MOLAR_VOLUME_25C} L/mol), the EPA reference condition.`,
    }
  }
  return null
}

function truncate(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.floor(value * factor) / factor
}

export interface SubIndex {
  parameter: string
  /** The concentration as reported by the monitor, unconverted. */
  reportedValue: number
  reportedUnit: string
  /** The concentration in the unit the standard's breakpoints use. */
  standardValue: number
  standardUnit: string
  /** The computed sub-index, 0–500. */
  aqi: number
  category: AqiCategory
  /** Averaging period the standard requires, hours. */
  requiredAveragingHours: number
  /** Averaging period the monitor's value actually represents, hours. */
  reportedAveragingHours: number
  /** False when the two differ — the single biggest caveat on this number. */
  averagingPeriodMatches: boolean
  /** Stated assumption behind any unit conversion performed. */
  conversionNote: string | null
  /** Set when the concentration exceeds the top breakpoint for this pollutant. */
  aboveScale: boolean
}

export type SubIndexFailure =
  | { parameter: string; reason: 'unsupported-pollutant' }
  | { parameter: string; reason: 'unconvertible-unit'; reportedUnit: string }
  | { parameter: string; reason: 'above-scale'; reportedValue: number; reportedUnit: string }

/**
 * Compute one pollutant's EPA sub-index.
 *
 * @param reportedAveragingHours The averaging period the supplied value
 *   represents. OpenAQ's latest endpoint is typically hourly, so callers pass 1
 *   and the result honestly records the mismatch for PM, O₃ and CO.
 */
export function subIndexFor(
  parameter: string,
  value: number,
  unit: string,
  reportedAveragingHours = 1,
): SubIndex | SubIndexFailure {
  const spec = SPECS[parameter]
  if (!spec) return { parameter, reason: 'unsupported-pollutant' }

  const converted = toStandardUnit(value, unit, spec)
  if (!converted) return { parameter, reason: 'unconvertible-unit', reportedUnit: unit }

  const c = truncate(Math.max(converted.value, 0), spec.truncateTo)
  const top = spec.breakpoints[spec.breakpoints.length - 1]
  if (c > top[1]) {
    return { parameter, reason: 'above-scale', reportedValue: value, reportedUnit: unit }
  }

  const bp = spec.breakpoints.find((b) => c >= b[0] && c <= b[1]) ?? spec.breakpoints[0]
  const [cLow, cHigh, iLow, iHigh] = bp
  // The Appendix G piecewise-linear interpolation.
  const aqi = Math.round(((iHigh - iLow) / (cHigh - cLow)) * (c - cLow) + iLow)

  return {
    parameter,
    reportedValue: value,
    reportedUnit: unit,
    standardValue: c,
    standardUnit: spec.standardUnit === 'ug/m3' ? 'µg/m³' : spec.standardUnit,
    aqi,
    category: categoryFor(aqi),
    requiredAveragingHours: spec.averagingHours,
    reportedAveragingHours,
    averagingPeriodMatches: spec.averagingHours === reportedAveragingHours,
    conversionNote: converted.note,
    aboveScale: false,
  }
}

export interface AqiResult {
  /** The overall AQI: the maximum sub-index, as the standard specifies. */
  aqi: number
  category: AqiCategory
  /** Which pollutant drove the overall value. */
  dominantParameter: string
  subIndices: SubIndex[]
  failures: SubIndexFailure[]
  /** True when any contributing sub-index used a mismatched averaging period. */
  anyPeriodMismatch: boolean
  standard: typeof AQI_STANDARD
}

/**
 * The overall AQI is the maximum of the available sub-indices — that is the
 * standard's definition, not an average.
 */
export function computeAqi(
  readings: { parameter: string; value: number; unit: string }[],
  reportedAveragingHours = 1,
): AqiResult | null {
  const subIndices: SubIndex[] = []
  const failures: SubIndexFailure[] = []

  for (const reading of readings) {
    const result = subIndexFor(reading.parameter, reading.value, reading.unit, reportedAveragingHours)
    if ('aqi' in result) subIndices.push(result)
    else failures.push(result)
  }

  if (subIndices.length === 0) return null

  const dominant = subIndices.reduce((max, s) => (s.aqi > max.aqi ? s : max), subIndices[0])
  return {
    aqi: dominant.aqi,
    category: dominant.category,
    dominantParameter: dominant.parameter,
    subIndices: subIndices.sort((a, b) => b.aqi - a.aqi),
    failures,
    anyPeriodMismatch: subIndices.some((s) => !s.averagingPeriodMatches),
    standard: AQI_STANDARD,
  }
}

export function describeFailure(failure: SubIndexFailure): string {
  switch (failure.reason) {
    case 'unsupported-pollutant':
      return `${failure.parameter}: the EPA index defines no sub-index for this pollutant.`
    case 'unconvertible-unit':
      return `${failure.parameter}: reported in "${failure.reportedUnit}", which cannot be converted to the unit the breakpoints use, so no sub-index is computed.`
    case 'above-scale':
      return `${failure.parameter}: ${failure.reportedValue} ${failure.reportedUnit} exceeds the top EPA breakpoint, which the index does not extend past.`
  }
}
