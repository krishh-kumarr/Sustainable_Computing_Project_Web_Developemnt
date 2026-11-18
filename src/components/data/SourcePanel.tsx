import { ExternalLink } from 'lucide-react'
import DataSourceBadge from './DataSourceBadge'
import LastUpdated from './LastUpdated'
import { getSource, type DataKind, type SourceId } from '../../services/config/dataSources'

export interface SourceField {
  parameter: string
  value: string
  unit: string
  kind: DataKind
}

interface Props {
  sourceId: SourceId
  /** The place these values describe. */
  locationLabel: string
  fields: SourceField[]
  observedAt: string | null
  fetchedAt: string
  stale?: boolean
  /** Provider caveats carried through from the response envelope. */
  notes?: string[]
  className?: string
}

/**
 * The source-information block that accompanies every data-driven panel:
 * source, location, parameter, value, unit, data type, and timestamp, with a
 * clickable attribution link.
 */
export default function SourcePanel({
  sourceId,
  locationLabel,
  fields,
  observedAt,
  fetchedAt,
  stale,
  notes,
  className = '',
}: Props) {
  const source = getSource(sourceId)
  const coverageNote = source.coverageNote

  return (
    <div className={`bg-white border border-graphite/10 rounded-xl overflow-hidden ${className}`}>
      <div className="px-5 py-3.5 border-b border-graphite/8 bg-graphite/[0.02] flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-0.5">
            Data source
          </div>
          <a
            href={source.docsUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-graphite hover:text-sage inline-flex items-center gap-1 transition-colors"
          >
            {source.name} <ExternalLink size={10} className="text-graphite/35" />
          </a>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-0.5">
            Location
          </div>
          <div className="text-sm font-medium text-graphite">{locationLabel}</div>
        </div>
      </div>

      <div className="divide-y divide-graphite/6">
        {fields.map((field) => (
          <div
            key={field.parameter}
            className="px-5 py-3 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 items-center"
          >
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium">Parameter</div>
              <div className="text-[13px] text-graphite/75 leading-snug">{field.parameter}</div>
            </div>
            <div className="sm:text-right">
              <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium">Value / unit</div>
              <div className="text-[13px] font-semibold text-graphite tabular-nums">
                {field.value}
                {field.unit && <span className="text-graphite/45 font-medium ml-1">{field.unit}</span>}
              </div>
            </div>
            <div className="sm:justify-self-end">
              <DataSourceBadge kind={field.kind} />
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 py-3.5 border-t border-graphite/8 bg-graphite/[0.02] space-y-2">
        <LastUpdated observedAt={observedAt} fetchedAt={fetchedAt} stale={stale} />
        {(coverageNote || (notes && notes.length > 0)) && (
          <ul className="space-y-1 pt-1">
            {coverageNote && (
              <li className="text-[11px] text-graphite/45 leading-relaxed flex gap-1.5">
                <span className="text-graphite/25 shrink-0">·</span>
                <span>{coverageNote}</span>
              </li>
            )}
            {notes?.map((note) => (
              <li key={note} className="text-[11px] text-graphite/45 leading-relaxed flex gap-1.5">
                <span className="text-graphite/25 shrink-0">·</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        )}
        {source.attribution && (
          <div className="text-[10px] text-graphite/35 pt-1 leading-relaxed">{source.attribution}</div>
        )}
      </div>
    </div>
  )
}
