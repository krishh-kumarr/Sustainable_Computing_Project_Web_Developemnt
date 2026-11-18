/**
 * Asks the backend proxy which credentialed integrations are configured.
 *
 * Without this the UI cannot tell "the provider is down" from "nobody has set
 * the key yet" — two problems with entirely different user-facing answers.
 */

import { expectObject, requestJson, retag, type Envelope } from './client'

export interface IntegrationStatus {
  configured: boolean
  keyName?: string
  endpoint?: string
}

export interface ProxyHealth {
  reachable: boolean
  checkedAt: string
  integrations: {
    openaq: IntegrationStatus
    firms: IntegrationStatus
    overpass: IntegrationStatus
  }
}

function readStatus(raw: unknown): IntegrationStatus {
  if (!raw || typeof raw !== 'object') return { configured: false }
  const r = raw as Record<string, unknown>
  return {
    configured: Boolean(r.configured),
    keyName: r.keyName ? String(r.keyName) : undefined,
    endpoint: r.endpoint ? String(r.endpoint) : undefined,
  }
}

export async function fetchProxyHealth(options: { signal?: AbortSignal; bypassCache?: boolean } = {}): Promise<
  Envelope<ProxyHealth>
> {
  const result = await requestJson<ProxyHealth>('/api/health', {
    cacheKey: 'proxy-health',
    sourceId: 'none',
    signal: options.signal,
    bypassCache: options.bypassCache,
    ttlMs: 60 * 1000,
    timeoutMs: 8_000,
    retries: 0,
    parse: (raw) => {
      const body = expectObject(raw, 'none', 'health response')
      const integrations = expectObject(body.integrations, 'none', 'integrations')
      return {
        reachable: true,
        checkedAt: String(body.checkedAt ?? new Date().toISOString()),
        integrations: {
          openaq: readStatus(integrations.openaq),
          firms: readStatus(integrations.firms),
          overpass: readStatus(integrations.overpass),
        },
      }
    },
  })
  return retag(result, { kind: 'observation', observedAt: result.data.checkedAt })
}
