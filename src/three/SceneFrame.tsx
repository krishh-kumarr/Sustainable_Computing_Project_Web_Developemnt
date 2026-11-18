import { Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader2 } from 'lucide-react'
import type { WebGLRenderer } from 'three'
import {
  recordResourceCleanup,
  registerAnimationLoop,
  registerScene,
  updateSceneResources,
} from '../services/domain/greenMonitor'

interface Props {
  children: ReactNode
  /** Camera position in world units. */
  cameraPosition?: [number, number, number]
  fov?: number
  /** Canvas background. Scenes keep the platform's graphite stage colour. */
  background?: string
  height?: number | string
  /** Overlaid legend / readout, rendered above the canvas. */
  overlay?: ReactNode
  /** Caption under the viewport explaining what the visuals encode. */
  caption?: ReactNode
  className?: string
}

function Fallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-ivory/35 text-xs gap-2">
      <Loader2 size={12} className="animate-spin" /> Preparing scene
    </div>
  )
}

/**
 * Shared viewport shell for every 3D scene, so the scenes stay consistent and
 * each one can carry the legend that explains what its visuals encode.
 */
export default function SceneFrame({
  children,
  cameraPosition = [0, 0, 3.4],
  fov = 48,
  background = '#171B19',
  height = 420,
  overlay,
  caption,
  className = '',
}: Props) {
  const [visible, setVisible] = useState(true)
  const frameRef = useRef<HTMLDivElement>(null)
  const sceneId = useId()
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const dpr = useMemo(() => {
    const cores = navigator.hardwareConcurrency ?? 4
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
    return cores <= 2 || memory <= 2 ? 1 : 1.5
  }, [])

  useEffect(() => {
    const unregister = registerScene(true)
    const updateResources = () => {
      const info = rendererRef.current?.info.memory
      if (info) updateSceneResources(sceneId, info.geometries + info.textures)
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.01 })
    if (frameRef.current) observer.observe(frameRef.current)
    const resourceTimer = window.setInterval(updateResources, 2000)
    return () => {
      window.clearInterval(resourceTimer)
      observer.disconnect()
      unregister()
      updateSceneResources(sceneId, null)
      recordResourceCleanup()
    }
  }, [className, sceneId])

  useEffect(() => {
    if (visible) {
      return registerAnimationLoop(true)
    }
  }, [visible])

  return (
    <div ref={frameRef} className={className}>
      <div className="relative rounded-xl overflow-hidden" style={{ height, background }}>
        <Canvas
          camera={{ position: cameraPosition, fov }}
          gl={{ antialias: true, alpha: false }}
          dpr={dpr}
          frameloop={visible ? 'always' : 'never'}
          onCreated={({ gl }) => {
            rendererRef.current = gl
            const info = gl.info.memory
            updateSceneResources(sceneId, info.geometries + info.textures)
          }}
          style={{ background }}
        >
          <Suspense fallback={null}>{children}</Suspense>
        </Canvas>
        <Suspense fallback={<Fallback />}>{null}</Suspense>
        {overlay && <div className="absolute inset-0 pointer-events-none">{overlay}</div>}
      </div>
      {caption && (
        <div className="mt-2.5 text-[11px] text-graphite/45 leading-relaxed">{caption}</div>
      )}
    </div>
  )
}
