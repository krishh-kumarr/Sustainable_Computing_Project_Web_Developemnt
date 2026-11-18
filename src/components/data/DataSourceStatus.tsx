import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, XCircle } from 'lucide-react'
import { getSource, type SourceId } from '../../services/config/dataSources'

export type IntegrationState =
  /** A request succeeded and the panel is showing returned data. */
  | 'live'
  /** Request in flight. */
  | 'loading'
  /** Succeeded, but the provider has no data for this location. */
  | 'no-coverage'
  /** The request failed. */
  | 'failed'
  /** Showing a last-known-good copy after a live failure. */
  | 'cached'
  /** Not integrated in this phase at all. */
  | 'not-integrated'

export interface SourceStatusEntry {
  sourceId: SourceId
  state: IntegrationState
  /** What the panel is actually showing, or why it isn't. */
  detail?: string
}

const PRESENTATION: Record<
  IntegrationState,
  { label: string; tone: string; background: string; Icon: typeof CheckCircle2 }
> = {
  live: { label: 'Returning data', tone: '#4A6356', background: '#EDF3EE', Icon: CheckCircle2 },
  loading: { label: 'Requesting', tone: '#5B6E79', background: '#EEF3F5', Icon: Loader2 },
  'no-coverage': { label: 'No coverage here', tone: '#8A8780', background: '#F2F1ED', Icon: CircleSlash },
  failed: { label: 'Request failed', tone: '#B4453C', background: '#FBEDEC', Icon: XCircle },
  cached: { label: 'Showing cached copy', tone: '#9A6B25', background: '#FBF4E8', Icon: AlertTriangle },
  'not-integrated': { label: 'Not integrated', tone: '#8A8780', background: '#F2F1ED', Icon: CircleSlash },
}

interface Props {
  entries: SourceStatusEntry[]
  className?: string
}

/**
 * Per-module integration status. The point of this panel is that a reader can
 * tell at a glance which numbers on the page came from a live request and which
 * are missing, and why — without having to open a network inspector.
 */
export default function DataSourceStatus({ entries, className = '' }: Props) {
  return (
    <div className={`bg-white border border-graphite/10 rounded-xl p-5 ${className}`}>
      <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-3.5">
        Data source status
      </div>
      <ul className="space-y-2.5">
        {entries.map((entry) => {
          const source = getSource(entry.sourceId)
          const presentation = PRESENTATION[entry.state]
          const { Icon } = presentation
          return (
            <li key={`${entry.sourceId}-${entry.detail ?? ''}`} className="flex items-start gap-2.5">
              <span
                className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: presentation.background }}
              >
                <Icon
                  size={11}
                  style={{ color: presentation.tone }}
                  className={entry.state === 'loading' ? 'animate-spin' : ''}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {source.docsUrl ? (
                    <a
                      href={source.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] font-medium text-graphite hover:text-sage transition-colors"
                    >
                      {source.name}
                    </a>
                  ) : (
                    <span className="text-[13px] font-medium text-graphite">{source.name}</span>
                  )}
                  <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: presentation.tone }}>
                    {presentation.label}
                  </span>
                </div>
                {entry.detail && (
                  <div className="text-[11px] text-graphite/45 leading-snug mt-0.5">{entry.detail}</div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Map an async result plus proxy-health knowledge to a status entry. */
export function statusFromResult(
  sourceId: SourceId,
  result: { status: string; error: { kind: string } | null; envelope: { stale?: boolean } | null },
  options: { keyConfigured?: boolean; detailWhenLive?: string } = {},
): SourceStatusEntry {
  if (options.keyConfigured === false) {
    return { sourceId, state: 'not-integrated', detail: 'This optional integration is not included.' }
  }
  if (result.status === 'loading') return { sourceId, state: 'loading' }
  if (result.envelope?.stale) return { sourceId, state: 'cached', detail: 'Live request failed; last good response shown.' }
  if (result.status === 'error') {
    const kind = result.error?.kind
    if (kind === 'auth') return { sourceId, state: 'not-integrated', detail: 'This optional integration is not included.' }
    if (kind === 'empty' || kind === 'unsupported-location') {
      return { sourceId, state: 'no-coverage', detail: 'The provider returned nothing for this location.' }
    }
    return { sourceId, state: 'failed', detail: 'See the panel above for details.' }
  }
  if (result.status === 'success') return { sourceId, state: 'live', detail: options.detailWhenLive }
  return { sourceId, state: 'loading' }
}
