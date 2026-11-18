import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Bookmark, Minus, RotateCcw, Scale, Trash2 } from 'lucide-react'
import DataSourceBadge from '../data/DataSourceBadge'
import { ComparisonChart } from './SimulationChart'
import {
  formatChange,
  formatMetric,
  mergeSeriesForChart,
  summarise,
  type MetricComparison,
} from '../../simulation/scenarios/compare.ts'
import type { SeriesKey } from '../../simulation/types/engine.ts'
import type { SimulationController } from '../../simulation/state/useSimulation.ts'

interface Props {
  controller: SimulationController<unknown>
  seriesKeys: SeriesKey[]
  timeUnit: 'hours' | 'days' | 'months' | 'years' | 'seconds'
  accentColor: string
  className?: string
}

const VERDICT_PRESENTATION: Record<
  MetricComparison['verdict'],
  { tone: string; background: string; Icon: typeof ArrowUpRight; label: string }
> = {
  better: { tone: '#4A6356', background: '#EDF3EE', Icon: ArrowDownRight, label: 'Improved' },
  worse: { tone: '#B4453C', background: '#FBEDEC', Icon: ArrowUpRight, label: 'Worsened' },
  unchanged: { tone: '#8A8780', background: '#F2F1ED', Icon: Minus, label: 'Unchanged' },
  changed: { tone: '#5B6E79', background: '#EEF3F5', Icon: ArrowUpRight, label: 'Changed' },
  incomparable: { tone: '#8A8780', background: '#F2F1ED', Icon: Minus, label: 'Not comparable' },
}

/**
 * Baseline-versus-alternative comparison.
 *
 * Both sides are complete headless runs over the same simulated span, so the
 * comparison never depends on how long the user happened to watch the
 * animation. Metrics are judged on their own declared direction, and a change
 * that helps some and hurts others is reported as a trade-off rather than
 * collapsed into a verdict.
 */
export default function ScenarioComparison({
  controller,
  seriesKeys,
  timeUnit,
  accentColor,
  className = '',
}: Props) {
  const { baselineRun, comparison, captureBaseline, clearBaseline, restoreBaseline, presets, applyPreset, activePresetId } =
    controller
  const [chartKey, setChartKey] = useState(seriesKeys[0]?.key ?? '')

  const chartRows = useMemo(() => {
    if (!comparison || !chartKey) return []
    return mergeSeriesForChart(comparison.baseline, comparison.alternative, chartKey)
  }, [comparison, chartKey])

  const chartDefinition = seriesKeys.find((key) => key.key === chartKey)

  return (
    <div className={`bg-white border border-graphite/10 rounded-xl p-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Scale size={13} className="text-graphite/40" />
          <span className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium">
            Scenario comparison
          </span>
        </div>
        {baselineRun && (
          <button
            onClick={clearBaseline}
            className="inline-flex items-center gap-1 text-[11px] text-graphite/45 hover:text-graphite transition-colors"
          >
            <Trash2 size={10} /> Clear baseline
          </button>
        )}
      </div>

      {/* Preset scenarios */}
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-wider text-graphite/30 font-medium mb-2">
          Preset scenarios
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              title={preset.description}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                activePresetId === preset.id
                  ? 'border-graphite/30 bg-graphite/5 text-graphite'
                  : 'border-graphite/12 text-graphite/55 hover:border-graphite/25'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {activePresetId && (
          <p className="text-[11px] text-graphite/45 leading-relaxed mt-2">
            {presets.find((preset) => preset.id === activePresetId)?.description}
          </p>
        )}
      </div>

      {!baselineRun ? (
        <div className="bg-graphite/[0.03] border border-graphite/10 rounded-lg p-4">
          <p className="text-[12px] text-graphite/60 leading-relaxed mb-3">
            Capture the current parameters as a baseline, then change something. Both sides are run to
            completion over the same simulated span, so the difference you see is the effect of the
            change and nothing else.
          </p>
          <button
            onClick={() => captureBaseline()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold rounded-lg text-white"
            style={{ backgroundColor: accentColor }}
          >
            <Bookmark size={11} /> Capture baseline
          </button>
        </div>
      ) : !comparison ? null : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <DataSourceBadge kind="model" size="sm" overrideLabel="Baseline captured" />
            <span className="text-[11px] text-graphite/45">
              {comparison.parameterDeltas.length === 0
                ? 'No parameter differs from the baseline yet.'
                : `${comparison.parameterDeltas.length} parameter${comparison.parameterDeltas.length === 1 ? '' : 's'} changed`}
            </span>
            <button
              onClick={restoreBaseline}
              className="inline-flex items-center gap-1 text-[11px] text-graphite/45 hover:text-graphite transition-colors ml-auto"
            >
              <RotateCcw size={10} /> Restore baseline parameters
            </button>
          </div>

          <p
            className="text-[12px] leading-relaxed px-3.5 py-2.5 rounded-lg border"
            style={{
              color: comparison.isTradeOff ? '#9A6B25' : '#252A27',
              backgroundColor: comparison.isTradeOff ? '#FBF4E8' : '#F4F3EF',
              borderColor: comparison.isTradeOff ? '#C39A6240' : '#25252212',
            }}
          >
            {summarise(comparison)}
          </p>

          {/* Changed parameters */}
          {comparison.parameterDeltas.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-graphite/30 font-medium mb-2">
                What changed
              </div>
              <ul className="space-y-1">
                {comparison.parameterDeltas.map((delta) => (
                  <li key={delta.spec.key} className="flex items-baseline justify-between gap-3 text-[11px]">
                    <span className="text-graphite/60 truncate">{delta.spec.label}</span>
                    <span className="text-graphite/75 tabular-nums shrink-0">
                      {delta.from.toLocaleString(undefined, { maximumFractionDigits: delta.spec.decimals ?? 2 })}
                      {' → '}
                      <strong className="font-semibold">
                        {delta.to.toLocaleString(undefined, { maximumFractionDigits: delta.spec.decimals ?? 2 })}
                      </strong>
                      {delta.spec.unit && <span className="text-graphite/40"> {delta.spec.unit}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Metric comparison table */}
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-graphite/40 text-left">
                  <th className="font-medium pb-2 pr-3">Metric</th>
                  <th className="font-medium pb-2 pr-3 text-right">Baseline</th>
                  <th className="font-medium pb-2 pr-3 text-right">Alternative</th>
                  <th className="font-medium pb-2 text-right">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite/6">
                {comparison.metrics
                  .filter((metric) => metric.verdict !== 'incomparable')
                  .map((metric) => {
                    const presentation = VERDICT_PRESENTATION[metric.verdict]
                    const { Icon } = presentation
                    return (
                      <tr key={metric.definition.key}>
                        <td className="py-2 pr-3 text-graphite/70">{metric.definition.label}</td>
                        <td className="py-2 pr-3 text-right text-graphite/55 tabular-nums whitespace-nowrap">
                          {formatMetric(metric.baseline, metric.definition)}
                        </td>
                        <td className="py-2 pr-3 text-right text-graphite/75 tabular-nums whitespace-nowrap font-medium">
                          {formatMetric(metric.alternative, metric.definition)}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded tabular-nums"
                            style={{ color: presentation.tone, backgroundColor: presentation.background }}
                            title={presentation.label}
                          >
                            {metric.verdict !== 'unchanged' && <Icon size={9} />}
                            {formatChange(metric)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>

          {/* Trade-off callout */}
          {comparison.isTradeOff && (
            <div className="bg-amber/8 border border-amber/25 rounded-lg px-3.5 py-3">
              <div className="text-[10px] uppercase tracking-wider text-graphite/45 font-medium mb-1.5">
                Trade-off
              </div>
              <p className="text-[11px] text-graphite/60 leading-relaxed">
                Improved: {comparison.improved.map((metric) => metric.definition.label).join(', ')}.
                <br />
                Worsened: {comparison.worsened.map((metric) => metric.definition.label).join(', ')}.
                <br />
                Which of these matters more is a judgement about priorities, and this model does not make
                it for you.
              </p>
            </div>
          )}

          {/* Series comparison chart */}
          {seriesKeys.length > 0 && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="text-[10px] uppercase tracking-wider text-graphite/30 font-medium">
                  Trajectory comparison
                </div>
                <select
                  value={chartKey}
                  onChange={(event) => setChartKey(event.target.value)}
                  className="px-2 py-1 text-[11px] rounded-lg border border-graphite/15 bg-white text-graphite/70 focus:outline-none focus:border-sage/50"
                >
                  {seriesKeys.map((key) => (
                    <option key={key.key} value={key.key}>
                      {key.label}
                    </option>
                  ))}
                </select>
              </div>
              <ComparisonChart
                rows={chartRows}
                label={chartDefinition?.label ?? ''}
                unit={chartDefinition?.unit ?? ''}
                timeUnit={timeUnit}
                accentColor={accentColor}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
