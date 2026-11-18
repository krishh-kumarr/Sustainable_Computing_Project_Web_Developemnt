/** Is the backend proxy up, and which credentialed integrations are configured? */

import { fetchProxyHealth, type ProxyHealth } from '../api/proxyHealth'
import { useAsyncData, type AsyncResult } from './useAsyncData'

export function useProxyHealth(): AsyncResult<ProxyHealth> {
  return useAsyncData<ProxyHealth>((signal, bypassCache) => fetchProxyHealth({ signal, bypassCache }), [], {
    staleFallbackKey: 'proxy-health',
  })
}
