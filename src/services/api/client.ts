/**
 * The single HTTP path to every external data source.
 *
 * Responsibilities, in order of importance:
 *   - classify failures precisely, so the UI can say what went wrong;
 *   - never invent a value when a request fails;
 *   - cache successful responses so navigating between modules does not refetch;
 *   - keep a last-known-good copy, served only when explicitly labelled stale;
 *   - validate payload shape before any component sees it.
 */

import type { DataKind, SourceId } from '../config/dataSources'
import { recordApiRequest } from '../domain/greenMonitor'

// ── Error taxonomy ────────────────────────────────────────────────────────

export type ApiErrorKind =
  | 'network' // DNS, offline, CORS, connection refused
  | 'timeout' // we gave up waiting
  | 'http' // upstream returned a non-2xx we can't categorise further
  | 'auth' // missing or rejected credential
  | 'rate-limit' // provider throttled us
  | 'validation' // 2xx, but the payload isn't what the contract promises
  | 'unsupported-location' // provider has no coverage here
  | 'empty' // valid response, nothing in it
  | 'aborted' // caller cancelled (location change, unmount)

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number
  readonly sourceId?: SourceId
  /** Set when the failure is specifically a missing server-side credential. */
  readonly missingKeyEnvVar?: string
  readonly detail?: unknown

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { status?: number; sourceId?: SourceId; missingKeyEnvVar?: string; detail?: unknown } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = options.status
    this.sourceId = options.sourceId
    this.missingKeyEnvVar = options.missingKeyEnvVar
    this.detail = options.detail
  }

  /** Is retrying this plausibly useful? */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'rate-limit' || this.kind === 'http'
  }
}

export function isAbort(error: unknown): boolean {
  return (
    (error instanceof ApiError && error.kind === 'aborted') ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

/** Human-facing message for any failure, without guessing at numbers. */
export function describeError(error: ApiError): string {
  switch (error.kind) {
    case 'auth':
      return error.missingKeyEnvVar
        ? `This panel needs the ${error.missingKeyEnvVar} credential, which is not configured on the server.`
        : 'The provider rejected our credential for this request.'
    case 'rate-limit':
      return 'The provider is rate-limiting requests right now. Waiting a moment usually clears it.'
    case 'timeout':
      return 'The provider did not respond in time.'
    case 'network':
      return 'Could not reach the provider. Check the network connection, and that the API proxy is running.'
    case 'validation':
      return 'The provider responded, but not in the shape this integration expects. Nothing is shown rather than showing a guess.'
    case 'unsupported-location':
      return 'This provider has no coverage for the selected location.'
    case 'empty':
      return 'The provider responded successfully but returned no records for this query.'
    case 'http':
      return `The provider returned an error${error.status ? ` (HTTP ${error.status})` : ''}.`
    case 'aborted':
      return 'Request cancelled.'
  }
}

// ── Response envelope ─────────────────────────────────────────────────────

/**
 * Everything the UI needs to describe a value truthfully: the value, where it
 * came from, what kind of value it is, and when it was observed vs fetched.
 */
export interface Envelope<T> {
  data: T
  sourceId: SourceId
  kind: DataKind
  /** When our client received this payload. */
  fetchedAt: string
  /**
   * The provider's own timestamp for the measurement, when it supplies one.
   * Null means the provider gave no observation time — in that case the UI
   * must show fetchedAt and say so, never pass fetch time off as observation
   * time.
   */
  observedAt: string | null
  /** The period a historical series covers, when applicable. */
  period?: { start: string; end: string }
  /** True when this came from the last-known-good cache after a live failure. */
  stale?: boolean
  /** Provider notes worth surfacing (coverage caveats, provisional flags). */
  notes?: string[]
}

export function envelope<T>(
  data: T,
  init: Omit<Envelope<T>, 'data' | 'fetchedAt'> & { fetchedAt?: string },
): Envelope<T> {
  return { data, fetchedAt: new Date().toISOString(), ...init }
}

// ── Cache ─────────────────────────────────────────────────────────────────

interface CacheEntry {
  value: unknown
  storedAt: number
  /** Provider timestamp carried alongside, so stale serves stay honest. */
  meta: { observedAt: string | null; fetchedAt: string }
}

const fresh = new Map<string, CacheEntry>()
/** Survives TTL expiry and failures; only ever served with stale: true. */
const lastKnownGood = new Map<string, CacheEntry>()
/**
 * De-duplicates concurrent identical requests across components.
 *
 * The subtlety: the shared request cannot run on any one caller's AbortSignal.
 * If it did, the first caller unmounting (which React StrictMode guarantees on
 * every mount in development) would abort the fetch that every other caller is
 * waiting on, and they would hang in their loading state forever.
 *
 * So the request runs on its own controller, and callers are reference-counted.
 * The underlying fetch is only aborted once every caller has gone away — after
 * a short grace period, so a StrictMode remount or a fast back-navigation
 * re-attaches to the request in flight instead of starting a second one.
 */
interface InFlightRequest {
  promise: Promise<unknown>
  controller: AbortController
  subscribers: number
  releaseTimer: ReturnType<typeof setTimeout> | null
}

const inFlight = new Map<string, InFlightRequest>()

/** How long a request survives with no subscribers before it is abandoned. */
const ORPHAN_GRACE_MS = 250

export const DEFAULT_TTL_MS = 10 * 60 * 1000

export function clearCache(prefix?: string): void {
  if (!prefix) {
    fresh.clear()
    lastKnownGood.clear()
    return
  }
  for (const key of [...fresh.keys()]) if (key.startsWith(prefix)) fresh.delete(key)
  for (const key of [...lastKnownGood.keys()]) if (key.startsWith(prefix)) lastKnownGood.delete(key)
}

export function peekLastKnownGood<T>(cacheKey: string): Envelope<T> | null {
  const entry = lastKnownGood.get(cacheKey)
  if (!entry) return null
  return entry.value as Envelope<T>
}

// ── Request ───────────────────────────────────────────────────────────────

export interface RequestOptions<T> {
  /** Stable identity for caching. Must encode every input that affects output. */
  cacheKey: string
  sourceId: SourceId
  signal?: AbortSignal
  timeoutMs?: number
  /** Attempts after the first. Kept low: these are public, shared services. */
  retries?: number
  ttlMs?: number
  headers?: Record<string, string>
  /** Force a network round trip, ignoring the fresh cache. */
  bypassCache?: boolean
  /**
   * Turns the raw payload into the typed result, and rejects anything that
   * doesn't match the contract. Throw ApiError('validation' | 'empty' | ...).
   */
  parse: (raw: unknown) => T
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new ApiError('aborted', 'Request cancelled.'))
    }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Our proxy's uniform error body. */
interface ProxyErrorBody {
  error?: { code?: string; message?: string; detail?: unknown }
}

function proxyErrorToApiError(status: number, body: ProxyErrorBody, sourceId: SourceId): ApiError {
  const code = body.error?.code
  const message = body.error?.message ?? `Proxy returned HTTP ${status}.`
  const detail = body.error?.detail as { keyName?: string } | null | undefined

  if (code === 'MISSING_API_KEY' || code === 'UPSTREAM_AUTH') {
    return new ApiError('auth', message, { status, sourceId, missingKeyEnvVar: detail?.keyName, detail })
  }
  if (code === 'RATE_LIMITED') return new ApiError('rate-limit', message, { status, sourceId, detail })
  if (code === 'INVALID_RESPONSE') return new ApiError('validation', message, { status, sourceId, detail })
  if (code === 'UPSTREAM_UNREACHABLE') return new ApiError('network', message, { status, sourceId, detail })
  return new ApiError('http', message, { status, sourceId, detail })
}

async function performRequest<T>(url: string, options: RequestOptions<T>): Promise<Envelope<T>> {
  const { sourceId, timeoutMs = 25_000, retries = 2, headers, parse, signal } = options
  let lastError: ApiError | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new ApiError('aborted', 'Request cancelled.')

    const controller = new AbortController()
    const onCallerAbort = () => controller.abort()
    signal?.addEventListener('abort', onCallerAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      recordApiRequest({ networkRequest: true })
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json', ...headers },
      })

      const text = await response.text()
      recordApiRequest({ transferredBytes: new TextEncoder().encode(text).byteLength })
      let body: unknown = null
      if (text.trim() !== '') {
        try {
          body = JSON.parse(text)
        } catch {
          if (response.ok) {
            throw new ApiError('validation', 'Provider returned a non-JSON payload.', {
              status: response.status,
              sourceId,
              detail: text.slice(0, 300),
            })
          }
        }
      }

      if (!response.ok) {
        // Our own proxy speaks a structured error dialect.
        if (body && typeof body === 'object' && 'error' in (body as object)) {
          const apiError = proxyErrorToApiError(response.status, body as ProxyErrorBody, sourceId)
          if (!apiError.retryable || attempt === retries) throw apiError
          lastError = apiError
        } else if (response.status === 401 || response.status === 403) {
          throw new ApiError('auth', 'The provider rejected this request as unauthorised.', {
            status: response.status,
            sourceId,
          })
        } else if (response.status === 404) {
          throw new ApiError('unsupported-location', 'The provider has no record for this query.', {
            status: response.status,
            sourceId,
          })
        } else if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          lastError = new ApiError(response.status === 429 ? 'rate-limit' : 'http', `HTTP ${response.status}`, {
            status: response.status,
            sourceId,
          })
        } else {
          // Open-Meteo reports parameter problems as {reason: "..."}.
          const reason =
            body && typeof body === 'object' && 'reason' in (body as Record<string, unknown>)
              ? String((body as Record<string, unknown>).reason)
              : undefined
          throw new ApiError(response.status === 429 ? 'rate-limit' : 'http', reason ?? `HTTP ${response.status}`, {
            status: response.status,
            sourceId,
          })
        }
      } else {
        // parse() owns validation, and throws ApiError for anything off-contract.
        const parsed = parse(body)
        return envelope(parsed, {
          sourceId,
          kind: 'observation', // callers override; see wrapEnvelope below
          observedAt: null,
        })
      }
    } catch (error) {
      if (isAbort(error)) {
        // Distinguish "caller cancelled" from "our own timeout fired".
        if (signal?.aborted) throw new ApiError('aborted', 'Request cancelled.', { sourceId })
        lastError = new ApiError('timeout', `No response within ${Math.round(timeoutMs / 1000)}s.`, { sourceId })
        if (attempt === retries) throw lastError
      } else if (error instanceof ApiError) {
        if (!error.retryable || attempt === retries) throw error
        lastError = error
      } else if (error instanceof TypeError) {
        // fetch() rejects with TypeError for network / CORS failures.
        lastError = new ApiError('network', 'Network request failed.', { sourceId, detail: String(error.message) })
        if (attempt === retries) throw lastError
      } else {
        throw new ApiError('http', String((error as Error)?.message ?? error), { sourceId })
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onCallerAbort)
    }

    // Exponential backoff with a modest ceiling — these are shared free services.
    await sleep(Math.min(400 * 2 ** attempt, 3_000), signal)
  }

  throw lastError ?? new ApiError('http', 'Request failed.', { sourceId })
}

/**
 * Cached, de-duplicated, retrying JSON GET.
 *
 * On failure this never substitutes fabricated data. It will optionally serve
 * the last known good payload, but only tagged `stale: true` with its original
 * timestamps intact, so the UI can label it as cached.
 */
export async function requestJson<T>(url: string, options: RequestOptions<T>): Promise<Envelope<T>> {
  const { cacheKey, ttlMs = DEFAULT_TTL_MS, bypassCache = false, signal } = options

  if (!bypassCache) {
    const hit = fresh.get(cacheKey)
    if (hit && Date.now() - hit.storedAt < ttlMs) {
      recordApiRequest({ cacheHit: true })
      return hit.value as Envelope<T>
    }
  }

  let entry = bypassCache ? undefined : inFlight.get(cacheKey)

  if (!entry) {
    const controller = new AbortController()
    const record: InFlightRequest = {
      // Assigned immediately below; the cast keeps the record self-referential
      // so performRequest's .finally can find it.
      promise: undefined as unknown as Promise<unknown>,
      controller,
      subscribers: 0,
      releaseTimer: null,
    }
    record.promise = performRequest<T>(url, { ...options, signal: controller.signal })
      .then((result) => {
        const stored: CacheEntry = {
          value: result,
          storedAt: Date.now(),
          meta: { observedAt: result.observedAt, fetchedAt: result.fetchedAt },
        }
        fresh.set(cacheKey, stored)
        lastKnownGood.set(cacheKey, stored)
        return result
      })
      .catch((error) => {
        recordApiRequest({ failed: true })
        throw error
      })
      .finally(() => {
        if (record.releaseTimer) clearTimeout(record.releaseTimer)
        if (inFlight.get(cacheKey) === record) inFlight.delete(cacheKey)
      })
    // Nothing may reject this promise before a caller attaches below.
    record.promise.catch(() => {})
    inFlight.set(cacheKey, record)
    entry = record
  }

  const request = entry
  request.subscribers++
  if (request.releaseTimer) {
    clearTimeout(request.releaseTimer)
    request.releaseTimer = null
  }

  const release = () => {
    request.subscribers--
    if (request.subscribers > 0 || request.releaseTimer) return
    request.releaseTimer = setTimeout(() => {
      request.releaseTimer = null
      if (request.subscribers === 0) {
        request.controller.abort()
        if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey)
      }
    }, ORPHAN_GRACE_MS)
  }

  // This caller's own cancellation detaches them from the shared request; it
  // does not cancel it for anybody else.
  if (!signal) {
    try {
      return (await request.promise) as Envelope<T>
    } finally {
      release()
    }
  }

  try {
    return await new Promise<Envelope<T>>((resolve, reject) => {
      const onAbort = () => reject(new ApiError('aborted', 'Request cancelled.', { sourceId: options.sourceId }))
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
      request.promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort)
          resolve(value as Envelope<T>)
        },
        (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        },
      )
    })
  } finally {
    release()
  }
}

/** Re-tag an envelope with the right kind / timestamps after parsing. */
export function retag<T>(
  env: Envelope<T>,
  patch: Partial<Pick<Envelope<T>, 'kind' | 'observedAt' | 'period' | 'notes' | 'sourceId'>>,
): Envelope<T> {
  return { ...env, ...patch }
}

// ── Validation helpers used by the per-provider parsers ───────────────────

export function expectObject(raw: unknown, sourceId: SourceId, what: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError('validation', `Expected ${what} to be an object.`, { sourceId, detail: raw })
  }
  return raw as Record<string, unknown>
}

export function expectArray(raw: unknown, sourceId: SourceId, what: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new ApiError('validation', `Expected ${what} to be an array.`, { sourceId, detail: raw })
  }
  return raw
}

/** Coerce to a finite number, or null. Never substitutes a fallback value. */
export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** NASA POWER and some others use a sentinel for "no data". */
export function finiteExcept(value: unknown, sentinel: number): number | null {
  const n = finiteOrNull(value)
  return n === null || n === sentinel ? null : n
}

export function requireNonEmpty<T>(items: T[], sourceId: SourceId, what: string): T[] {
  if (items.length === 0) {
    throw new ApiError('empty', `The provider returned no ${what} for this query.`, { sourceId })
  }
  return items
}
