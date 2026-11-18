import type { TelemetrySample } from './browserTelemetry'

export interface ApiMonitorStats {
  requests: number
  cacheHits: number
  failedRequests: number
  transferredBytes: number
}

export interface MonitorSnapshot {
  api: ApiMonitorStats
  telemetry: TelemetrySample | null
  activeScenes: number
  activeAnimationLoops: number
  loadedResources: number | null
  cleanedResources: number
}

type Listener = () => void

const STORAGE_KEY = 'terraverse-green-monitor'
const api: ApiMonitorStats = {
  requests: 0,
  cacheHits: 0,
  failedRequests: 0,
  transferredBytes: 0,
}
const listeners = new Set<Listener>()
let activeScenes = 0
let activeAnimationLoops = 0
let loadedResources: number | null = null
let cleanedResources = 0
let telemetry: TelemetrySample | null = null
const sceneResources = new Map<string, number>()
let snapshot: MonitorSnapshot = {
  api: { ...api },
  telemetry: null,
  activeScenes: 0,
  activeAnimationLoops: 0,
  loadedResources: null,
  cleanedResources: 0,
}

try {
  const saved = sessionStorage.getItem(STORAGE_KEY)
  if (saved) {
    const parsed = JSON.parse(saved) as Partial<Pick<MonitorSnapshot, 'api' | 'cleanedResources'>>
    if (parsed.api) Object.assign(api, parsed.api)
    if (typeof parsed.cleanedResources === 'number') cleanedResources = parsed.cleanedResources
    snapshot = { ...snapshot, api: { ...api }, cleanedResources }
  }
} catch {
  // Storage is optional; the monitor remains usable in private browsing modes.
}

function notify() {
  snapshot = {
    api: { ...api },
    telemetry,
    activeScenes,
    activeAnimationLoops,
    loadedResources: sceneResources.size > 0
      ? [...sceneResources.values()].reduce((sum, count) => sum + count, 0)
      : loadedResources,
    cleanedResources,
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ api, cleanedResources }))
  } catch {
    // Storage is optional and must not interfere with measurements.
  }
  listeners.forEach((listener) => listener())
}

export function recordApiRequest(event: { networkRequest?: boolean; cacheHit?: boolean; failed?: boolean; transferredBytes?: number }) {
  if (event.cacheHit) api.cacheHits++
  if (event.networkRequest) api.requests++
  if (event.failed) api.failedRequests++
  if (event.transferredBytes) api.transferredBytes += event.transferredBytes
  notify()
}

export function setTelemetrySample(sample: TelemetrySample | null) {
  telemetry = sample
  notify()
}

export function registerScene(active: boolean) {
  activeScenes = Math.max(0, activeScenes + (active ? 1 : -1))
  notify()
  return () => {
    registerScene(false)
  }
}

export function registerAnimationLoop(active: boolean) {
  activeAnimationLoops = Math.max(0, activeAnimationLoops + (active ? 1 : -1))
  notify()
  return () => {
    registerAnimationLoop(false)
  }
}

export function setLoadedResources(count: number | null) {
  loadedResources = count
  notify()
}

export function updateSceneResources(sceneId: string, count: number | null) {
  if (count === null) sceneResources.delete(sceneId)
  else sceneResources.set(sceneId, count)
  notify()
}

export function recordResourceCleanup(count = 1) {
  cleanedResources += Math.max(0, count)
  notify()
}

export function subscribeGreenMonitor(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getGreenMonitorSnapshot(): MonitorSnapshot {
  if (!snapshot) notify()
  return snapshot
}

export function resetGreenMonitor() {
  api.requests = 0
  api.cacheHits = 0
  api.failedRequests = 0
  api.transferredBytes = 0
  telemetry = null
  cleanedResources = 0
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage is optional.
  }
  notify()
}
