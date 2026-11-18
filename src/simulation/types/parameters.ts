/**
 * Typed parameter definitions shared by every simulation engine.
 *
 * Parameters are a flat `Record<string, number>` on purpose: it keeps
 * validation, diffing, serialisation and scenario comparison uniform across
 * seven very different models, and it means a scenario is always a plain
 * JSON-serialisable object.
 *
 * Every spec carries a `note` explaining where its default comes from. That is
 * not documentation politeness — a model output is only as meaningful as the
 * provenance of the numbers fed into it, and the UI renders these notes beside
 * the controls.
 */

/** Cross-module levers. A parameter bound to one of these follows it. */
export type SharedLeverKey =
  | 'temperatureAnomalyK'
  | 'precipitationScalePercent'
  | 'gridCarbonIntensity'
  | 'renewableSharePercent'

export interface ParameterOption {
  value: number
  label: string
}

export interface ParameterSpec {
  key: string
  label: string
  /** Unit string, shown verbatim. Empty for dimensionless ratios. */
  unit: string
  min: number
  max: number
  step: number
  default: number
  /** Where this default comes from, and what accepting it commits you to. */
  note: string
  /** UI grouping. */
  group?: string
  decimals?: number
  /** Render as a discrete selector rather than a slider. */
  options?: ParameterOption[]
  /** Binds this parameter to a platform-wide lever shared between modules. */
  sharedKey?: SharedLeverKey
  /**
   * Set when the default is seeded from live observed data rather than being a
   * literal. The UI badges these so a reader can tell a measured starting point
   * from an assumed one.
   */
  seededFromObservation?: boolean
}

export type ParameterValues = Record<string, number>

export function defaultValues(specs: ParameterSpec[]): ParameterValues {
  const values: ParameterValues = {}
  for (const spec of specs) values[spec.key] = spec.default
  return values
}

export interface ValidationIssue {
  key: string
  message: string
}

/**
 * Clamps every value into its declared range and reports what was changed.
 * Returns a new object; never mutates the input.
 */
export function validate(
  specs: ParameterSpec[],
  values: ParameterValues,
): { values: ParameterValues; issues: ValidationIssue[] } {
  const out: ParameterValues = {}
  const issues: ValidationIssue[] = []

  for (const spec of specs) {
    const raw = values[spec.key]
    if (raw === undefined) {
      out[spec.key] = spec.default
      issues.push({ key: spec.key, message: `Missing; using the default of ${spec.default}.` })
      continue
    }
    if (!Number.isFinite(raw)) {
      out[spec.key] = spec.default
      issues.push({ key: spec.key, message: `Not a finite number; using the default of ${spec.default}.` })
      continue
    }
    if (spec.options) {
      const match = spec.options.find((option) => option.value === raw)
      if (!match) {
        out[spec.key] = spec.default
        issues.push({ key: spec.key, message: `"${raw}" is not one of the allowed options.` })
        continue
      }
      out[spec.key] = raw
      continue
    }
    if (raw < spec.min) {
      out[spec.key] = spec.min
      issues.push({ key: spec.key, message: `Below the minimum of ${spec.min} ${spec.unit}; clamped.` })
      continue
    }
    if (raw > spec.max) {
      out[spec.key] = spec.max
      issues.push({ key: spec.key, message: `Above the maximum of ${spec.max} ${spec.unit}; clamped.` })
      continue
    }
    out[spec.key] = raw
  }

  // Keys the engine does not declare are dropped rather than passed through,
  // so a stale saved scenario cannot smuggle an unknown value into a model.
  for (const key of Object.keys(values)) {
    if (!specs.some((spec) => spec.key === key)) {
      issues.push({ key, message: 'Unknown parameter for this engine; ignored.' })
    }
  }

  return { values: out, issues }
}

export function findSpec(specs: ParameterSpec[], key: string): ParameterSpec | undefined {
  return specs.find((spec) => spec.key === key)
}

/** Parameters that differ from the given set, with both values. */
export interface ParameterDelta {
  spec: ParameterSpec
  from: number
  to: number
  /** Signed change as a percentage of the `from` value, null when from is 0. */
  percentChange: number | null
}

export function diffParameters(
  specs: ParameterSpec[],
  from: ParameterValues,
  to: ParameterValues,
): ParameterDelta[] {
  const deltas: ParameterDelta[] = []
  for (const spec of specs) {
    const a = from[spec.key]
    const b = to[spec.key]
    if (a === undefined || b === undefined || a === b) continue
    deltas.push({
      spec,
      from: a,
      to: b,
      percentChange: a === 0 ? null : ((b - a) / Math.abs(a)) * 100,
    })
  }
  return deltas
}
