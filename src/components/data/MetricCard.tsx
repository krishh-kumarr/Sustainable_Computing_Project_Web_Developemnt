import { HelpCircle } from 'lucide-react'
import DataSourceBadge from './DataSourceBadge'
import { getSource, type DataKind, type SourceId } from '../../services/config/dataSources'

interface Props {
  label: string
  /** The value exactly as computed or returned. Null renders as unavailable. */
  value: number | string | null
  unit?: string
  /** Decimal places for numeric values. */
  decimals?: number
  kind: DataKind
  sourceId: SourceId
  /** Secondary line: the parameter's full name, or the formula behind it. */
  detail?: string
  /** Hover explanation — caveats, averaging periods, assumptions. */
  note?: string
  accentColor?: string
  /** Shown when value is null, in place of the figure. */
  unavailableReason?: string
  className?: string
}

/**
 * One number, with everything needed to read it honestly: its unit, what kind
 * of number it is, and which source produced it.
 */
export default function MetricCard({
  label,
  value,
  unit,
  decimals = 1,
  kind,
  sourceId,
  detail,
  note,
  accentColor,
  unavailableReason,
  className = '',
}: Props) {
  const source = getSource(sourceId)
  const available = value !== null && value !== ''
  const display =
    typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: decimals }) : value

  return (
    <div className={`bg-white border border-graphite/10 rounded-xl p-5 flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="text-[11px] uppercase tracking-widest text-graphite/40 font-medium leading-tight">
          {label}
        </div>
        {note && (
          <span title={note} aria-label={note} className="shrink-0 mt-0.5 cursor-help">
            <HelpCircle size={12} className="text-graphite/25" />
          </span>
        )}
      </div>

      {available ? (
        <div className="flex items-baseline gap-1 mb-1">
          <span
            className="text-[28px] leading-none font-semibold tracking-tight"
            style={{ color: accentColor ?? '#252A27' }}
          >
            {display}
          </span>
          {unit && <span className="text-sm text-graphite/45 font-medium">{unit}</span>}
        </div>
      ) : (
        <div className="mb-1">
          <span className="text-[22px] leading-none font-semibold text-graphite/20">—</span>
        </div>
      )}

      {available && detail && <div className="text-[11px] text-graphite/45 leading-snug mb-3">{detail}</div>}
      {!available && (
        <div className="text-[11px] text-graphite/45 leading-snug mb-3">
          {unavailableReason ?? 'No source could supply this value here.'}
        </div>
      )}

      <div className="mt-auto pt-2.5 border-t border-graphite/6 flex flex-wrap items-center gap-2">
        <DataSourceBadge kind={available ? kind : 'unavailable'} />
        {source.docsUrl ? (
          <a
            href={source.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-graphite/40 hover:text-sage underline decoration-graphite/15 hover:decoration-sage transition-colors"
          >
            {source.name}
          </a>
        ) : (
          <span className="text-[11px] text-graphite/35">{source.name}</span>
        )}
      </div>
    </div>
  )
}
