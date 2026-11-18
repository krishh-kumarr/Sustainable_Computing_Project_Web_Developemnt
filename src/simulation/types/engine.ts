/**
 * The contract every simulation engine implements.
 *
 * Three rules hold across all seven:
 *
 *  1. **Determinism.** `step` is a pure function of (state, params, baseline,
 *     tick). No `Date.now()`, no `Math.random()`, no reads of React state. The
 *     same inputs always produce the same trajectory, which is what makes
 *     scenario comparison a measurement rather than an impression.
 *  2. **No calculation in components.** Everything numeric lives here; React
 *     renders the output and nothing more.
 *  3. **Self-documenting.** Each engine carries its own assumptions and emits a
 *     formula chain, so any number it produces can be checked by hand.
 */

import type { DataKind, SourceId } from '../../services/config/dataSources'
import type { ParameterSpec, ParameterValues } from './parameters.ts'

export interface MetricDefinition {
  key: string
  label: string
  unit: string
  /** Provenance badge. Engine outputs are 'model' unless passed straight
   *  through from an observation. */
  kind: DataKind
  decimals?: number
  note?: string
  /** Direction of improvement, for the scenario comparison verdict. Omit when
   *  a metric has no inherent better direction (it is just a quantity). */
  lowerIsBetter?: boolean
  /** Attribution when the value derives from a specific provider. */
  sourceId?: SourceId
  /** Show this metric in the compact headline row. */
  headline?: boolean
}

export type MetricValues = Record<string, number | null>

export interface SeriesKey {
  key: string
  label: string
  unit: string
  /** Chart colour. Defaults to the module accent when omitted. */
  colour?: string
  /** Draw on a secondary axis. */
  secondaryAxis?: boolean
}

export type SeriesRow = Record<string, number | null> & { t: number }

export type ScenarioKind = 'baseline' | 'alternative' | 'optimised'

export interface ScenarioPreset {
  id: string
  label: string
  description: string
  kind: ScenarioKind
  /** Only the parameters this preset changes; the rest stay as they are. */
  overrides: ParameterValues
}

/**
 * Whatever real, fetched data the engine needs as its starting point.
 * Always nullable: an engine must still run when a provider had nothing for
 * this location, and must say which of its inputs were observed and which were
 * assumed.
 */
export interface EngineBaseline {
  /** Human-readable description of where the starting values came from. */
  provenance: string[]
  /** True when at least one real observation seeded the run. */
  seededFromObservation: boolean
}

export interface SimulationEngine<S, B extends EngineBaseline> {
  id: string
  label: string
  /** Simulated time advanced by one tick. */
  tickHours: number
  /** Default simulated span of a complete run. */
  defaultDurationHours: number
  /** Unit the UI should display elapsed simulated time in. */
  timeUnit: 'hours' | 'days' | 'months' | 'years' | 'seconds'
  parameters: ParameterSpec[]
  metrics: MetricDefinition[]
  series: SeriesKey[]
  presets: ScenarioPreset[]
  /** Assumptions a reader must accept for the output to mean anything. */
  assumptions: string[]
  /** One-paragraph statement of what this model is and is not. */
  disclaimer: string

  init(params: ParameterValues, baseline: B): S
  step(state: S, params: ParameterValues, baseline: B, tickHours: number): S
  derive(state: S, params: ParameterValues, baseline: B): MetricValues
  sample(state: S, params: ParameterValues, baseline: B): SeriesRow
  /** The formula chain behind the current numbers, rendered verbatim. */
  explain(state: S, params: ParameterValues, baseline: B): string[]
  /** Simulated hours completed, used for the progress indicator. */
  elapsedHours(state: S): number
  /** True when the run has reached its natural end. */
  isComplete?(state: S, params: ParameterValues): boolean
}

/** A completed headless run: what scenario comparison actually compares. */
export interface ScenarioRun {
  id: string
  label: string
  kind: ScenarioKind
  params: ParameterValues
  metrics: MetricValues
  series: SeriesRow[]
  durationHours: number
  /** When this run was computed. Runs are deterministic, so this is only for
   *  the UI to show how recently the user captured it. */
  computedAt: string
  explain: string[]
}

/**
 * Runs an engine to completion without touching React.
 *
 * This is what makes comparison honest: the baseline and the alternative are
 * both complete runs over the same span, not two snapshots caught at whatever
 * moment the user happened to hit a button.
 */
export function runToCompletion<S, B extends EngineBaseline>(
  engine: SimulationEngine<S, B>,
  params: ParameterValues,
  baseline: B,
  options: { durationHours?: number; label?: string; kind?: ScenarioKind; id?: string } = {},
): ScenarioRun {
  const durationHours = options.durationHours ?? engine.defaultDurationHours
  // Guard against a pathological tick size producing an unbounded loop.
  const maxTicks = 20_000
  const tickCount = Math.min(Math.ceil(durationHours / engine.tickHours), maxTicks)

  let state = engine.init(params, baseline)
  const series: SeriesRow[] = [engine.sample(state, params, baseline)]

  for (let i = 0; i < tickCount; i++) {
    if (engine.isComplete?.(state, params)) break
    state = engine.step(state, params, baseline, engine.tickHours)
    series.push(engine.sample(state, params, baseline))
  }

  return {
    id: options.id ?? `run-${engine.id}-${series.length}`,
    label: options.label ?? 'Run',
    kind: options.kind ?? 'alternative',
    params: { ...params },
    metrics: engine.derive(state, params, baseline),
    series,
    durationHours: engine.elapsedHours(state),
    computedAt: new Date().toISOString(),
    explain: engine.explain(state, params, baseline),
  }
}

/** Downsample a series for charting without distorting its shape. */
export function thinSeries(series: SeriesRow[], maxPoints = 160): SeriesRow[] {
  if (series.length <= maxPoints) return series
  const stride = Math.ceil(series.length / maxPoints)
  const out: SeriesRow[] = []
  for (let i = 0; i < series.length; i += stride) out.push(series[i])
  // Always keep the final point: the end state is the one the metrics describe.
  const last = series[series.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}
