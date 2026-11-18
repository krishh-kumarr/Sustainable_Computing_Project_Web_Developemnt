/**
 * Scenario comparison.
 *
 * Deliberately refuses to declare a winner overall. Each metric is judged on
 * its own declared direction, and a comparison that improves some metrics while
 * worsening others is reported as exactly that — a trade-off — rather than
 * being collapsed into a single score that hides what was given up.
 */

import type { MetricDefinition, ScenarioRun } from '../types/engine.ts'
import { diffParameters, type ParameterDelta, type ParameterSpec } from '../types/parameters.ts'

export type MetricVerdict = 'better' | 'worse' | 'unchanged' | 'changed' | 'incomparable'

export interface MetricComparison {
  definition: MetricDefinition
  baseline: number | null
  alternative: number | null
  /** alternative − baseline. Null when either side is unavailable. */
  absoluteChange: number | null
  /** Signed percentage change. Null when the baseline is zero or unavailable. */
  percentChange: number | null
  verdict: MetricVerdict
}

export interface ScenarioComparison {
  baseline: ScenarioRun
  alternative: ScenarioRun
  parameterDeltas: ParameterDelta[]
  metrics: MetricComparison[]
  /** Metrics that improved, on their own declared direction. */
  improved: MetricComparison[]
  /** Metrics that worsened. The point of showing these is the trade-off. */
  worsened: MetricComparison[]
  /** True when the alternative improves some metrics and worsens others. */
  isTradeOff: boolean
  /** True when nothing measurable changed. */
  isIdentical: boolean
}

/** Treat differences below this fraction of the baseline as noise. */
const RELATIVE_EPSILON = 0.0005

function verdictFor(
  definition: MetricDefinition,
  baseline: number | null,
  alternative: number | null,
): MetricVerdict {
  if (baseline === null || alternative === null) return 'incomparable'
  const scale = Math.max(Math.abs(baseline), 1e-9)
  if (Math.abs(alternative - baseline) / scale < RELATIVE_EPSILON) return 'unchanged'
  // A metric with no declared direction is a quantity, not a goal. Saying a
  // changed quantity is "better" would be the model editorialising.
  if (definition.lowerIsBetter === undefined) return 'changed'
  const improved = definition.lowerIsBetter ? alternative < baseline : alternative > baseline
  return improved ? 'better' : 'worse'
}

export function compareRuns(
  definitions: MetricDefinition[],
  specs: ParameterSpec[],
  baseline: ScenarioRun,
  alternative: ScenarioRun,
): ScenarioComparison {
  const metrics: MetricComparison[] = definitions.map((definition) => {
    const a = baseline.metrics[definition.key] ?? null
    const b = alternative.metrics[definition.key] ?? null
    const absoluteChange = a === null || b === null ? null : b - a
    const percentChange = a === null || b === null || a === 0 ? null : ((b - a) / Math.abs(a)) * 100
    return {
      definition,
      baseline: a,
      alternative: b,
      absoluteChange,
      percentChange,
      verdict: verdictFor(definition, a, b),
    }
  })

  const improved = metrics.filter((metric) => metric.verdict === 'better')
  const worsened = metrics.filter((metric) => metric.verdict === 'worse')

  return {
    baseline,
    alternative,
    parameterDeltas: diffParameters(specs, baseline.params, alternative.params),
    metrics,
    improved,
    worsened,
    isTradeOff: improved.length > 0 && worsened.length > 0,
    isIdentical: metrics.every(
      (metric) => metric.verdict === 'unchanged' || metric.verdict === 'incomparable',
    ),
  }
}

/** One-line summary of a comparison, stating trade-offs rather than hiding them. */
export function summarise(comparison: ScenarioComparison): string {
  if (comparison.isIdentical) {
    return 'No parameter change produced a measurable difference in any metric.'
  }
  const { improved, worsened } = comparison
  if (improved.length > 0 && worsened.length === 0) {
    return `The alternative improves ${improved.length} metric${improved.length === 1 ? '' : 's'} with no metric worsening.`
  }
  if (worsened.length > 0 && improved.length === 0) {
    return `The alternative worsens ${worsened.length} metric${worsened.length === 1 ? '' : 's'} with no offsetting improvement.`
  }
  if (comparison.isTradeOff) {
    return `Trade-off: ${improved.length} metric${improved.length === 1 ? '' : 's'} improve while ${worsened.length} worsen${worsened.length === 1 ? 's' : ''}. Which matters more is a judgement this model cannot make for you.`
  }
  return 'Quantities changed, but none of them has a declared better direction.'
}

/** Merge two runs' series into rows the comparison chart can plot directly. */
export function mergeSeriesForChart(
  baseline: ScenarioRun,
  alternative: ScenarioRun,
  seriesKey: string,
): { t: number; baseline: number | null; alternative: number | null }[] {
  const length = Math.max(baseline.series.length, alternative.series.length)
  const rows: { t: number; baseline: number | null; alternative: number | null }[] = []
  for (let i = 0; i < length; i++) {
    const a = baseline.series[i]
    const b = alternative.series[i]
    rows.push({
      t: (a?.t ?? b?.t) as number,
      baseline: (a?.[seriesKey] as number | null | undefined) ?? null,
      alternative: (b?.[seriesKey] as number | null | undefined) ?? null,
    })
  }
  return rows
}

export function formatMetric(value: number | null, definition: MetricDefinition): string {
  if (value === null) return '—'
  const decimals = definition.decimals ?? 1
  return `${value.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: 0 })}${definition.unit ? ` ${definition.unit}` : ''}`
}

export function formatChange(comparison: MetricComparison): string {
  if (comparison.absoluteChange === null) return '—'
  const decimals = comparison.definition.decimals ?? 1
  const sign = comparison.absoluteChange > 0 ? '+' : ''
  const absolute = `${sign}${comparison.absoluteChange.toLocaleString(undefined, { maximumFractionDigits: decimals })}`
  if (comparison.percentChange === null) return `${absolute} ${comparison.definition.unit}`.trim()
  const percentSign = comparison.percentChange > 0 ? '+' : ''
  return `${absolute} ${comparison.definition.unit} (${percentSign}${comparison.percentChange.toFixed(1)}%)`.trim()
}
