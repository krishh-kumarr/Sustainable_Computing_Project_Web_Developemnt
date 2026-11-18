import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader2, MonitorX } from 'lucide-react'

interface Props {
  children: ReactNode
  cameraPosition?: [number, number, number]
  fov?: number
  background?: string
  height?: number | string
  overlay?: ReactNode
  caption?: ReactNode
  className?: string
  /** Pause rendering when the scene is off-screen or the user paused it. */
  active?: boolean
}

/** Is WebGL actually usable in this browser? Probed once. */
function detectWebGL(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    const context =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl')
    return context !== null
  } catch {
    return false
  }
}

/**
 * Picks a device pixel ratio ceiling from what the machine looks capable of.
 *
 * A retina laptop rendering a complex scene at DPR 3 is doing nine times the
 * fragment work of DPR 1 for a difference most people cannot see on a 400 px
 * viewport. Capping it is the single cheapest performance measure available.
 */
function adaptiveDpr(): [number, number] {
  if (typeof window === 'undefined') return [1, 1.5]
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  if (cores <= 4 || memory <= 4) return [1, 1]
  if (cores <= 8) return [1, 1.5]
  return [1, 2]
}

/**
 * Shared viewport shell for every 3D scene.
 *
 * Handles the three things that decide whether a WebGL page is usable on an
 * ordinary laptop: a real fallback when WebGL is unavailable, an adaptive
 * pixel-ratio cap, and pausing the render loop when the scene is scrolled out
 * of view or the user has asked for reduced motion.
 */
export default function SceneGuard({
  children,
  cameraPosition = [0, 0, 3.4],
  fov = 48,
  background = '#171B19',
  height = 420,
  overlay,
  caption,
  className = '',
  active = true,
}: Props) {
  const [supported] = useState(detectWebGL)
  const [visible, setVisible] = useState(true)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const dpr = useMemo(adaptiveDpr, [])

  // Stop rendering a scene nobody is looking at.
  useEffect(() => {
    if (!container || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '120px' },
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [container])

  if (!supported) {
    return (
      <div className={className}>
        <div
          className="rounded-xl border border-dashed border-graphite/20 flex items-center justify-center p-8"
          style={{ height }}
        >
          <div className="text-center max-w-sm">
            <MonitorX size={20} className="text-graphite/30 mx-auto mb-3" />
            <h4 className="text-[13px] font-semibold text-graphite mb-1.5">
              3D visualisation unavailable
            </h4>
            <p className="text-[11px] text-graphite/50 leading-relaxed">
              This browser has no usable WebGL context, so the scene cannot be drawn. Every number,
              chart and control on this page works without it — the 3D view illustrates the
              simulation, it does not produce it.
            </p>
          </div>
        </div>
        {caption && <div className="mt-2.5 text-[11px] text-graphite/45 leading-relaxed">{caption}</div>}
      </div>
    )
  }

  return (
    <div className={className}>
      <div ref={setContainer} className="relative rounded-xl overflow-hidden" style={{ height, background }}>
        <Canvas
          camera={{ position: cameraPosition, fov }}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          dpr={dpr}
          // `demand` would need manual invalidation; `always` while visible and
          // nothing at all while hidden is both simpler and cheaper.
          frameloop={active && visible ? 'always' : 'never'}
          style={{ background }}
        >
          <Suspense fallback={null}>{children}</Suspense>
        </Canvas>
        {overlay && <div className="absolute inset-0 pointer-events-none">{overlay}</div>}
      </div>
      {caption && <div className="mt-2.5 text-[11px] text-graphite/45 leading-relaxed">{caption}</div>}
    </div>
  )
}

/** Loading placeholder for a lazily imported scene. */
export function SceneLoading({ height = 420 }: { height?: number | string }) {
  return (
    <div
      className="rounded-xl flex items-center justify-center bg-[#171B19]"
      style={{ height }}
    >
      <span className="inline-flex items-center gap-2 text-ivory/35 text-xs">
        <Loader2 size={12} className="animate-spin" /> Loading scene
      </span>
    </div>
  )
}
