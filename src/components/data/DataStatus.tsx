import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import DataUnavailable from './DataUnavailable'
import type { AsyncResult } from '../../services/hooks/useAsyncData'
import type { SourceId } from '../../services/config/dataSources'

interface Props<T> {
  result: AsyncResult<T>
  /** What the reader was expecting — used in the loading and failure states. */
  title: string
  sourceId: SourceId
  /** Rendered once data is in hand. Receives the envelope's payload. */
  children: (data: T, meta: { stale: boolean; observedAt: string | null; fetchedAt: string }) => ReactNode
  /** Height of the loading skeleton, so layout does not jump. */
  skeletonHeight?: number
  /** Shown beneath the failure message. */
  explanation?: string
  className?: string
}

/**
 * Wraps a data panel in its loading, error and unavailable states.
 *
 * Deliberately has no "fall back to sample data" branch. If the fetch failed
 * and there is no cached copy, the reader is told so.
 */
export default function DataStatus<T>({
  result,
  title,
  sourceId,
  children,
  skeletonHeight = 160,
  explanation,
  className = '',
}: Props<T>) {
  const { status, envelope, error, refetch, refreshing } = result

  if (status === 'idle') {
    return (
      <div
        className={`bg-white border border-graphite/10 rounded-xl p-6 flex items-center justify-center ${className}`}
        style={{ minHeight: skeletonHeight }}
      >
        <span className="text-xs text-graphite/35">{explanation ?? 'Waiting for a location selection.'}</span>
      </div>
    )
  }

  if (status === 'loading' && !envelope) {
    return (
      <div
        className={`bg-white border border-graphite/10 rounded-xl p-6 ${className}`}
        style={{ minHeight: skeletonHeight }}
      >
        <div className="flex items-center gap-2 text-xs text-graphite/40 mb-4">
          <Loader2 size={12} className="animate-spin" />
          <span className="uppercase tracking-widest font-medium">Fetching {title}</span>
        </div>
        <div className="space-y-2.5 animate-pulse">
          <div className="h-2.5 bg-graphite/6 rounded w-1/3" />
          <div className="h-2.5 bg-graphite/6 rounded w-2/3" />
          <div className="h-2.5 bg-graphite/6 rounded w-1/2" />
          <div className="h-2.5 bg-graphite/6 rounded w-3/5" />
        </div>
      </div>
    )
  }

  // A failure with a cached copy still shows the copy, clearly marked.
  if (status === 'error' && !envelope) {
    return (
      <DataUnavailable
        title={title}
        error={error}
        sourceId={sourceId}
        explanation={explanation}
        onRetry={refetch}
        className={className}
      />
    )
  }

  if (!envelope) return null

  return (
    <div className={`relative ${className}`}>
      {refreshing && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-graphite/35 bg-white/85 backdrop-blur-sm rounded-full px-2 py-1">
          <Loader2 size={9} className="animate-spin" /> Refreshing
        </div>
      )}
      {status === 'error' && envelope.stale && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-graphite/55 bg-amber/8 border border-amber/25 rounded-lg px-3 py-2">
          <span className="font-semibold uppercase tracking-wider text-[10px] text-amber">Cached data</span>
          <span>
            The live request failed, so the last successful response is shown with its original timestamp.
          </span>
          <button onClick={refetch} className="underline text-graphite/70 hover:text-graphite">
            Retry
          </button>
        </div>
      )}
      {children(envelope.data, {
        stale: Boolean(envelope.stale),
        observedAt: envelope.observedAt,
        fetchedAt: envelope.fetchedAt,
      })}
    </div>
  )
}
