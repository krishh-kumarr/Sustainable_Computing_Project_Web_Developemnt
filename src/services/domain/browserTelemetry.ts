/**
 * What this browser tab can honestly measure about itself.
 *
 * Read this before using any of it: a web page cannot measure whole-machine
 * CPU utilisation, cannot read power draw, and cannot see other processes. The
 * browser deliberately withholds those, both for privacy and because of timing
 * side-channel attacks.
 *
 * So this module measures the tab, labels everything as the tab's own figures,
 * and the UI must never present them as machine-level telemetry.
 */

export interface TelemetrySample {
  /** When this sample was taken. */
  at: string
  /**
   * Fraction of a frame budget consumed by this tab's main thread, 0–1,
   * derived from achieved frame rate against the display's refresh rate.
   * This is main-thread saturation for THIS TAB, not CPU utilisation.
   */
  mainThreadLoad: number | null
  /** Frames per second this tab actually achieved over the sample window. */
  framesPerSecond: number | null
  /** The display's refresh rate, inferred from the best frame interval seen. */
  estimatedRefreshHz: number | null
  /**
   * JS heap in use, bytes. Chromium-only (performance.memory), coarsened by
   * the browser, and only the JS heap — not the tab's full memory footprint.
   */
  jsHeapUsedBytes: number | null
  jsHeapLimitBytes: number | null
  /** Logical cores the browser is willing to disclose. */
  hardwareConcurrency: number | null
  /** Device memory in GiB, rounded by the browser to a coarse bucket. */
  deviceMemoryGiB: number | null
  /** Effective network type, from the Network Information API. */
  effectiveNetworkType: string | null
  /** Long tasks (>50 ms) observed on the main thread in the sample window. */
  longTaskCount: number
  longTaskTotalMs: number
}

/** Which of the above this browser actually supports. */
export interface TelemetryCapabilities {
  frameTiming: boolean
  jsHeap: boolean
  hardwareConcurrency: boolean
  deviceMemory: boolean
  networkInformation: boolean
  longTasks: boolean
}

export const TELEMETRY_LIMITATIONS: string[] = [
  'These figures describe this browser tab, not the machine. Whole-machine CPU, memory and power are not exposed to web pages at all.',
  'Main-thread load is inferred from achieved frame rate. A tab can be idle while the machine is saturated, and vice versa.',
  'JS heap size is Chromium-only and is deliberately coarsened by the browser; it excludes DOM, GPU and renderer-process memory.',
  'Logical core count and device memory are rounded into coarse buckets to resist fingerprinting.',
  'No browser API reports power draw, temperature or fan state. Any power figure in this module is calculated from the model inputs, not measured.',
]

interface MemoryCapablePerformance extends Performance {
  memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number }
}

interface NetworkInformationLike {
  effectiveType?: string
}

export function detectCapabilities(): TelemetryCapabilities {
  const perf = performance as MemoryCapablePerformance
  return {
    frameTiming: typeof requestAnimationFrame === 'function',
    jsHeap: typeof perf.memory?.usedJSHeapSize === 'number',
    hardwareConcurrency: typeof navigator.hardwareConcurrency === 'number',
    deviceMemory: typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === 'number',
    networkInformation:
      typeof (navigator as Navigator & { connection?: NetworkInformationLike }).connection === 'object',
    longTasks:
      typeof PerformanceObserver === 'function' &&
      Array.isArray(PerformanceObserver.supportedEntryTypes) &&
      PerformanceObserver.supportedEntryTypes.includes('longtask'),
  }
}

/**
 * Samples frame timing over `windowMs`, plus whatever static facts the browser
 * discloses. Resolves once. Cancel via the AbortSignal.
 */
export function sampleTelemetry(windowMs = 1000, signal?: AbortSignal): Promise<TelemetrySample> {
  return new Promise((resolve) => {
    const perf = performance as MemoryCapablePerformance
    const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection

    const intervals: number[] = []
    let longTaskCount = 0
    let longTaskTotalMs = 0

    let observer: PerformanceObserver | null = null
    if (detectCapabilities().longTasks) {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTaskCount++
            longTaskTotalMs += entry.duration
          }
        })
        observer.observe({ entryTypes: ['longtask'] })
      } catch {
        observer = null
      }
    }

    const start = performance.now()
    let previous = start
    let rafId = 0

    const finish = () => {
      cancelAnimationFrame(rafId)
      observer?.disconnect()
      signal?.removeEventListener('abort', finish)

      const elapsedMs = performance.now() - start
      const frames = intervals.length

      let framesPerSecond: number | null = null
      let estimatedRefreshHz: number | null = null
      let mainThreadLoad: number | null = null

      if (frames >= 1 && elapsedMs > 0) {
        framesPerSecond = (frames / elapsedMs) * 1000
        // The shortest interval observed is the closest this tab got to the
        // display's true cadence, so it is the best available refresh estimate.
        const best = Math.min(...intervals)
        estimatedRefreshHz = best > 0 ? 1000 / best : null
        if (estimatedRefreshHz && estimatedRefreshHz > 0) {
          // How far short of the display's cadence did we fall? That shortfall
          // is main-thread saturation for this tab.
          mainThreadLoad = Math.min(Math.max(1 - framesPerSecond / estimatedRefreshHz, 0), 1)
        }
      }

      resolve({
        at: new Date().toISOString(),
        mainThreadLoad,
        framesPerSecond,
        estimatedRefreshHz,
        jsHeapUsedBytes: perf.memory?.usedJSHeapSize ?? null,
        jsHeapLimitBytes: perf.memory?.jsHeapSizeLimit ?? null,
        hardwareConcurrency:
          typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null,
        deviceMemoryGiB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
        effectiveNetworkType: connection?.effectiveType ?? null,
        longTaskCount,
        longTaskTotalMs,
      })
    }

    const tick = (now: number) => {
      intervals.push(now - previous)
      previous = now
      if (now - start >= windowMs) return finish()
      rafId = requestAnimationFrame(tick)
    }

    if (signal?.aborted) return finish()
    signal?.addEventListener('abort', finish, { once: true })
    rafId = requestAnimationFrame(tick)
  })
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  const mib = bytes / (1024 * 1024)
  if (mib >= 1024) return `${(mib / 1024).toFixed(2)} GiB`
  return `${mib.toFixed(1)} MiB`
}
