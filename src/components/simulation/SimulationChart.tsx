import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AXIS_TICK, CHART_GRID_STROKE, TOOLTIP_STYLE } from '../data/chartFormat'
import type { SeriesKey, SeriesRow } from '../../simulation/types/engine.ts'

interface Props {
  series: SeriesRow[]
  keys: SeriesKey[]
  timeUnit: 'hours' | 'days' | 'months' | 'years' | 'seconds'
  accentColor: string
  height?: number
  /** Keys shown initially; the rest are toggleable. */
  defaultVisible?: string[]
  className?: string
}

const UNIT_LABEL: Record<Props['timeUnit'], string> = {
  seconds: 's',
  hours: 'h',
  days: 'd',
  months: 'months',
  years: 'yr',
}

/**
 * The live simulation chart. Every line is engine output recorded tick by
 * tick — nothing here is pre-computed or decorative, so the chart moves as the
 * simulation runs and changes shape when a parameter changes.
 */
export default function SimulationChart({
  series,
  keys,
  timeUnit,
  accentColor,
  height = 240,
  defaultVisible,
  className = '',
}: Props) {
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(defaultVisible ?? keys.slice(0, 2).map((key) => key.key)),
  )

  const shown = useMemo(() => keys.filter((key) => visible.has(key.key)), [keys, visible])
  const usesSecondaryAxis = shown.some((key) => key.secondaryAxis)

  const toggle = (key: string) => {
    setVisible((previous) => {
      const next = new Set(previous)
      if (next.has(key)) {
        // Never leave the chart with nothing plotted.
        if (next.size > 1) next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  if (series.length < 2) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-dashed border-graphite/15 ${className}`}
        style={{ height }}
      >
        <span className="text-[12px] text-graphite/40">
          Run the simulation to plot its output here.
        </span>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {keys.map((key) => (
          <button
            key={key.key}
            onClick={() => toggle(key.key)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-medium transition-colors ${
              visible.has(key.key)
                ? 'border-graphite/25 bg-graphite/4 text-graphite'
                : 'border-graphite/10 text-graphite/40 hover:border-graphite/20'
            }`}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: visible.has(key.key) ? (key.colour ?? accentColor) : '#C8C5BD' }}
            />
            {key.label}
            <span className="text-graphite/30">{key.unit && `(${key.unit})`}</span>
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={series} margin={{ top: 6, right: usesSecondaryAxis ? 6 : 10, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
          <XAxis
            dataKey="t"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            label={{
              value: UNIT_LABEL[timeUnit],
              position: 'insideBottomRight',
              offset: -2,
              fontSize: 10,
              fill: '#8A8780',
            }}
          />
          <YAxis yAxisId="left" tick={AXIS_TICK} axisLine={false} tickLine={false} width={54} />
          {usesSecondaryAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={54}
            />
          )}
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(value) => `${value} ${UNIT_LABEL[timeUnit]}`}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
          {shown.map((key) => (
            <Line
              key={key.key}
              yAxisId={key.secondaryAxis && usesSecondaryAxis ? 'right' : 'left'}
              type="monotone"
              dataKey={key.key}
              name={`${key.label}${key.unit ? ` (${key.unit})` : ''}`}
              stroke={key.colour ?? accentColor}
              strokeWidth={1.8}
              strokeDasharray={key.secondaryAxis ? '4 2' : undefined}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Baseline-versus-alternative chart for a single series key. */
export function ComparisonChart({
  rows,
  label,
  unit,
  timeUnit,
  accentColor,
  height = 200,
}: {
  rows: { t: number; baseline: number | null; alternative: number | null }[]
  label: string
  unit: string
  timeUnit: Props['timeUnit']
  accentColor: string
  height?: number
}) {
  if (rows.length < 2) return null
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
        <XAxis
          dataKey="t"
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          label={{
            value: UNIT_LABEL[timeUnit],
            position: 'insideBottomRight',
            offset: -2,
            fontSize: 10,
            fill: '#8A8780',
          }}
        />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={54} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelFormatter={(value) => `${value} ${UNIT_LABEL[timeUnit]}`}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
        <Area
          type="monotone"
          dataKey="baseline"
          name={`Baseline — ${label}${unit ? ` (${unit})` : ''}`}
          stroke="#8CA8B5"
          fill="#8CA8B518"
          strokeWidth={1.6}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="alternative"
          name={`Alternative — ${label}${unit ? ` (${unit})` : ''}`}
          stroke={accentColor}
          fill={`${accentColor}20`}
          strokeWidth={1.8}
          strokeDasharray="5 3"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
