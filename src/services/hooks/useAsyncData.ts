/**
 * The one hook every data panel uses.
 *
 * It guarantees the three things the platform promises about its data:
 *   - a request in flight is cancelled when its inputs change or the component
 *     unmounts, so a slow response can never overwrite a newer one;
 *   - a failure produces an error state, never a substituted value;
 *   - if a last-known-good response exists it may be shown, but only flagged
 *     `stale` with its original timestamps, so the UI can label it as cached.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, isAbort, peekLastKnownGood, type Envelope } from '../api/client'

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error'

export interface AsyncResult<T> {
  status: AsyncStatus
  envelope: Envelope<T> | null
  error: ApiError | null
  /** True while a refetch is in flight and previous data is still displayed. */
  refreshing: boolean
  /** Re-run the fetch, bypassing the fresh cache. */
  refetch: () => void
}

export interface UseAsyncDataOptions {
  /** Skip fetching entirely (e.g. a dependency isn't ready yet). */
  enabled?: boolean
  /**
   * Cache key to look up a last-known-good response if the live fetch fails.
   * Must match the key the underlying service uses.
   */
  staleFallbackKey?: string
  /** Auto-refetch interval, ms. Omit for fetch-once-per-dependency-change. */
  refreshIntervalMs?: number
}

export function useAsyncData<T>(
  fetcher: (signal: AbortSignal, bypassCache: boolean) => Promise<Envelope<T>>,
  deps: readonly unknown[],
  options: UseAsyncDataOptions = {},
): AsyncResult<T> {
  const { enabled = true, staleFallbackKey, refreshIntervalMs } = options

  const [status, setStatus] = useState<AsyncStatus>(enabled ? 'loading' : 'idle')
  const [envelope, setEnvelope] = useState<Envelope<T> | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Keep the latest fetcher without making it a dependency — callers write it
  // inline, so it is a new function identity on every render.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const controllerRef = useRef<AbortController | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const hasDataRef = useRef(false)

  const refetch = useCallback(() => {
    setReloadToken((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }

    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller

    let cancelled = false
    const bypassCache = reloadToken > 0

    if (hasDataRef.current) setRefreshing(true)
    else setStatus('loading')
    setError(null)

    fetcherRef
      .current(controller.signal, bypassCache)
      .then((result) => {
        if (cancelled) return
        hasDataRef.current = true
        setEnvelope(result)
        setStatus('success')
        setRefreshing(false)
      })
      .catch((caught: unknown) => {
        if (cancelled || isAbort(caught)) return
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError('http', String((caught as Error)?.message ?? caught))

        setError(apiError)
        setRefreshing(false)

        // A cached copy may be shown, but only clearly marked as stale with its
        // original timestamps. Never silently patched in as if it were fresh.
        const cached = staleFallbackKey ? peekLastKnownGood<T>(staleFallbackKey) : null
        if (cached) {
          setEnvelope({ ...cached, stale: true })
          hasDataRef.current = true
        } else {
          setEnvelope(null)
          hasDataRef.current = false
        }
        setStatus('error')
      })

    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, reloadToken, staleFallbackKey])

  // Periodic refresh for sources that genuinely update on a short cadence.
  useEffect(() => {
    if (!enabled || !refreshIntervalMs) return
    const timer = setInterval(() => setReloadToken((n) => n + 1), refreshIntervalMs)
    return () => clearInterval(timer)
  }, [enabled, refreshIntervalMs])

  return { status, envelope, error, refreshing, refetch }
}
