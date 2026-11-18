import { Clock } from 'lucide-react'

interface Props {
  /** The provider's own observation timestamp, when it supplies one. */
  observedAt: string | null
  /** When our client received the payload. */
  fetchedAt: string
  /** Set when this is a last-known-good copy shown after a live failure. */
  stale?: boolean
  label?: string
  className?: string
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function relative(iso: string): string | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const minutes = Math.round((Date.now() - t) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} d ago`
}

/**
 * Shows the observation timestamp when the provider gives one, and otherwise
 * says plainly that it is showing fetch time instead. Fetch time is never
 * presented as an observation time.
 */
export default function LastUpdated({ observedAt, fetchedAt, stale, label, className = '' }: Props) {
  const hasObservation = observedAt !== null && observedAt !== ''
  const primary = hasObservation ? observedAt : fetchedAt
  const ago = relative(primary)

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-graphite/45 ${className}`}>
      <Clock size={11} className="shrink-0" />
      <span className="uppercase tracking-wider font-medium text-graphite/35">
        {label ?? (hasObservation ? 'Observed' : 'Retrieved')}
      </span>
      <span className="text-graphite/60">{formatTimestamp(primary)}</span>
      {ago && <span className="text-graphite/35">({ago})</span>}
      {!hasObservation && (
        <span
          className="text-graphite/35 italic"
          title="This provider does not return an observation timestamp, so the time this client fetched the data is shown instead."
        >
          — provider gives no observation time
        </span>
      )}
      {stale && (
        <span className="px-1.5 py-0.5 rounded bg-amber/15 text-[10px] uppercase tracking-wider font-medium text-amber">
          Cached copy
        </span>
      )}
    </div>
  )
}
