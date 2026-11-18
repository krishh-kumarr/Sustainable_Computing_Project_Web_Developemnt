/** Shared helpers for building advisor findings. */

import type { MetricDefinition, MetricValues } from '../types/engine.ts'
import type { AdvisorContext, FindingMagnitude } from './types.ts'

/**
 * Measures the effect of a parameter change on one metric by re-running the
 * engine. Returns null when either side is unavailable, so a rule that cannot
 * quantify its claim simply does not make it.
 */
export function magnitude(
  context: AdvisorContext,
  definitions: MetricDefinition[],
  key: string,
  alternative: MetricValues,
): FindingMagnitude | null {
  const definition = definitions.find((entry) => entry.key === key)
  if (!definition) return null
  const current = context.metrics[key]
  const next = alternative[key]
  if (current === null || current === undefined || next === null || next === undefined) return null

  const value = next - current
  const percent = current === 0 ? null : (value / Math.abs(current)) * 100
  const isImprovement =
    definition.lowerIsBetter === undefined ? false : definition.lowerIsBetter ? value < 0 : value > 0

  return {
    label: definition.label,
    value,
    unit: definition.unit,
    decimals: definition.decimals ?? 1,
    percent,
    isImprovement,
  }
}

export function formatMagnitude(entry: FindingMagnitude): string {
  const sign = entry.value > 0 ? '+' : ''
  const absolute = `${sign}${entry.value.toLocaleString(undefined, { maximumFractionDigits: entry.decimals })}`
  const unit = entry.unit ? ` ${entry.unit}` : ''
  if (entry.percent === null) return `${absolute}${unit}`
  const percentSign = entry.percent > 0 ? '+' : ''
  return `${absolute}${unit} (${percentSign}${entry.percent.toFixed(1)} %)`
}

/** Treat a change below this fraction of the current value as not worth raising. */
export const MATERIALITY_THRESHOLD = 0.02

export function isMaterial(entry: FindingMagnitude | null): boolean {
  if (!entry) return false
  if (entry.percent === null) return Math.abs(entry.value) > 0
  return Math.abs(entry.percent) >= MATERIALITY_THRESHOLD * 100
}

export function percentText(value: number): string {
  return `${Math.abs(value).toFixed(1)} %`
}

export function number(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals })
}
