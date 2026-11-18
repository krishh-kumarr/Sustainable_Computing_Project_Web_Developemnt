import DataSourceBadge from '../data/DataSourceBadge'
import MetricCard from '../data/MetricCard'
import type { MetricDefinition, MetricValues } from '../../simulation/types/engine.ts'
import type { SourceId } from '../../services/config/dataSources'

interface Props {
  definitions: MetricDefinition[]
  values: MetricValues
  accentColor: string
  /** Show only the metrics flagged as headline. */
  headlineOnly?: boolean
  /** Exclude headline metrics, for a "everything else" grid. */
  excludeHeadline?: boolean
  columns?: 2 | 3 | 4
  className?: string
}

const COLUMN_CLASS: Record<number, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-4',
}

/**
 * Renders engine metrics with their provenance badges intact.
 *
 * Note the deliberate asymmetry: a metric the engine computed is badged as a
 * model estimate, while one passed straight through from a provider keeps its
 * observation badge. The grid never flattens that distinction.
 */
export default function MetricGrid({
  definitions,
  values,
  accentColor,
  headlineOnly = false,
  excludeHeadline = false,
  columns = 4,
  className = '',
}: Props) {
  const shown = definitions.filter((definition) => {
    if (headlineOnly) return definition.headline === true
    if (excludeHeadline) return definition.headline !== true
    return true
  })

  if (shown.length === 0) return null

  return (
    <div className={`grid ${COLUMN_CLASS[columns]} gap-3 ${className}`}>
      {shown.map((definition) => {
        const value = values[definition.key]
        return (
          <MetricCard
            key={definition.key}
            label={definition.label}
            value={value ?? null}
            unit={definition.unit}
            decimals={definition.decimals ?? 1}
            kind={definition.kind}
            sourceId={(definition.sourceId ?? 'terraverse-model') as SourceId}
            note={definition.note}
            accentColor={definition.headline ? accentColor : undefined}
            unavailableReason={
              definition.sourceId && definition.kind !== 'model' && definition.kind !== 'illustrative'
                ? 'The provider returned no value for this location.'
                : 'The model cannot compute this from the current inputs.'
            }
          />
        )
      })}
    </div>
  )
}

/** Compact inline readout for overlaying on a 3D scene. */
export function MetricStrip({
  definitions,
  values,
  keys,
}: {
  definitions: MetricDefinition[]
  values: MetricValues
  keys: string[]
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {keys.map((key) => {
        const definition = definitions.find((entry) => entry.key === key)
        if (!definition) return null
        const value = values[key]
        return (
          <span key={key} className="text-[11px] text-ivory/70 tabular-nums">
            <span className="text-ivory/40">{definition.label}: </span>
            {value === null || value === undefined
              ? '—'
              : value.toLocaleString(undefined, { maximumFractionDigits: definition.decimals ?? 1 })}
            {definition.unit && <span className="text-ivory/40"> {definition.unit}</span>}
          </span>
        )
      })}
    </div>
  )
}

/** Shows which provenance kinds appear in a metric set, as a legend. */
export function MetricProvenanceLegend({ definitions }: { definitions: MetricDefinition[] }) {
  const kinds = [...new Set(definitions.map((definition) => definition.kind))]
  return (
    <div className="flex flex-wrap items-center gap-2">
      {kinds.map((kind) => (
        <DataSourceBadge key={kind} kind={kind} />
      ))}
    </div>
  )
}
