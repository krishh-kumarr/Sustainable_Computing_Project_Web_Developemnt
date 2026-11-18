import { DATA_KIND_LABEL, DATA_KIND_MEANING, DATA_KIND_TONE, type DataKind } from '../../services/config/dataSources'

interface Props {
  kind: DataKind
  /** Shown instead of the standard label — use only to add precision, never to soften it. */
  overrideLabel?: string
  size?: 'sm' | 'xs'
  className?: string
}

/**
 * The label that tells the reader what kind of number they are looking at.
 * Every metric in the platform carries one.
 */
export default function DataSourceBadge({ kind, overrideLabel, size = 'xs', className = '' }: Props) {
  const tone = DATA_KIND_TONE[kind]
  const padding = size === 'sm' ? 'px-2.5 py-1' : 'px-2 py-0.5'
  const text = size === 'sm' ? 'text-[11px]' : 'text-[10px]'

  return (
    <span
      title={DATA_KIND_MEANING[kind]}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium uppercase tracking-wider whitespace-nowrap ${padding} ${text} ${className}`}
      style={{ color: tone.fg, backgroundColor: tone.bg, borderColor: tone.border }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tone.fg }} />
      {overrideLabel ?? DATA_KIND_LABEL[kind]}
    </span>
  )
}
