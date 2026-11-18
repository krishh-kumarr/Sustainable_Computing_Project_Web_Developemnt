/**
 * Recharts tooltip helpers.
 *
 * Charts in this app always label values with the unit the provider returned,
 * so these formatters take the unit explicitly rather than defaulting to none.
 *
 * The casts exist because Recharts' `Formatter` generic admits `undefined`
 * values, which our series never contain (nulls are passed through with
 * `connectNulls={false}`, so the tooltip is not rendered for them).
 */

type RechartsFormatter = never

/** `123 mm` — value with its unit, plus an optional friendly series name. */
export function unitFormatter(unit: string, names?: Record<string, string>): RechartsFormatter {
  const format = (value: unknown, name: unknown): [string, string] => [
    value === null || value === undefined ? '—' : `${value}${unit ? ` ${unit}` : ''}`,
    names?.[String(name)] ?? String(name),
  ]
  return format as unknown as RechartsFormatter
}

export const TOOLTIP_STYLE = {
  background: '#fff',
  border: '1px solid #25252218',
  borderRadius: 8,
  fontSize: 12,
  color: '#252A27',
} as const

export const CHART_GRID_STROKE = '#25252210'
export const AXIS_TICK = { fontSize: 11, fill: '#6E6A60' } as const
