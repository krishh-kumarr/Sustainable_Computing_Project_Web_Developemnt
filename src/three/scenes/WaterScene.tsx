import { useMemo, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Water scene driven by measured and forecast hydrology.
 *
 * Data connections, each stated in the legend:
 *   - rainfall rate (mm/h, observed or forecast) sets the rain particle count
 *     and fall speed;
 *   - water surface height follows either an observed gauge height or the
 *     user's scenario slider — the legend names which;
 *   - river discharge (m³/s) sets the surface flow speed.
 *
 * The wave geometry itself is a sine field. It conveys "moving water", not a
 * hydrodynamic solution, and the legend says so.
 */

interface Props {
  /** Rainfall intensity, mm/h. Null means unknown, and no rain is drawn. */
  rainfallMmPerHour: number | null
  /** Water surface level as a fraction of the channel depth, 0–1. */
  waterLevelFraction: number
  /** River discharge, m³/s. Drives flow speed. Null → still water. */
  dischargeCumecs: number | null
  /** Maximum discharge in the displayed series, for scaling flow speed. */
  dischargeScaleCumecs?: number | null
  /** Where the level figure came from — shown in the scene's own overlay. */
  levelProvenance: 'observed' | 'scenario'
}

const BASIN_WIDTH = 3.2
const BASIN_DEPTH = 2.4
/** Channel depth the level fraction is measured against, in scene units. */
const CHANNEL_DEPTH = 0.55

function Rain({ rainfallMmPerHour }: { rainfallMmPerHour: number }) {
  const pointsRef = useRef<THREE.Points>(null)

  // Particle count scales with intensity, capped so heavy rain stays legible.
  const count = Math.min(Math.round(120 + rainfallMmPerHour * 260), 3200)
  // Terminal velocity rises with drop size, which rises with intensity.
  const fallSpeed = 1.1 + Math.min(rainfallMmPerHour, 25) * 0.11

  const positions = useMemo(() => {
    const array = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      array[i * 3] = (Math.random() - 0.5) * BASIN_WIDTH
      array[i * 3 + 1] = Math.random() * 2.4
      array[i * 3 + 2] = (Math.random() - 0.5) * BASIN_DEPTH
    }
    return array
  }, [count])

  useFrame((_, delta) => {
    const geometry = pointsRef.current?.geometry
    if (!geometry) return
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
    const array = attribute.array as Float32Array
    for (let i = 0; i < array.length; i += 3) {
      array[i + 1] -= fallSpeed * delta
      if (array[i + 1] < 0.05) {
        array[i + 1] = 2.4
        array[i] = (Math.random() - 0.5) * BASIN_WIDTH
        array[i + 2] = (Math.random() - 0.5) * BASIN_DEPTH
      }
    }
    attribute.needsUpdate = true
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.016}
        color="#BAE6FD"
        transparent
        opacity={Math.min(0.35 + rainfallMmPerHour * 0.05, 0.9)}
        sizeAttenuation
      />
    </points>
  )
}

function WaterSurface({
  waterLevelFraction,
  dischargeCumecs,
  dischargeScaleCumecs,
}: Pick<Props, 'waterLevelFraction' | 'dischargeCumecs' | 'dischargeScaleCumecs'>) {
  const meshRef = useRef<THREE.Mesh>(null)
  const segments = 72

  const geometry = useMemo(
    () => new THREE.PlaneGeometry(BASIN_WIDTH, BASIN_DEPTH, segments, segments),
    [],
  )

  // Flow speed scales with discharge against the series' own maximum, so the
  // animation is relative to the data shown rather than to an absolute scale.
  const flowSpeed = useMemo(() => {
    if (dischargeCumecs === null || !dischargeScaleCumecs || dischargeScaleCumecs <= 0) return 0.35
    return 0.25 + Math.min(dischargeCumecs / dischargeScaleCumecs, 1.4) * 1.5
  }, [dischargeCumecs, dischargeScaleCumecs])

  const amplitude = 0.012 + Math.min(flowSpeed * 0.012, 0.03)

  useFrame(({ clock }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const t = clock.getElapsedTime()
    const attribute = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    const array = attribute.array as Float32Array
    for (let i = 0; i < array.length; i += 3) {
      const x = array[i]
      const y = array[i + 1]
      // Travelling sine field — a visual cue for moving water, not a solver.
      array[i + 2] =
        Math.sin(x * 4.2 + t * flowSpeed * 2.2) * amplitude +
        Math.sin(y * 5.8 - t * flowSpeed * 1.5) * amplitude * 0.6
    }
    attribute.needsUpdate = true
    mesh.geometry.computeVertexNormals()
  })

  const level = Math.min(Math.max(waterLevelFraction, 0), 1)

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, level * CHANNEL_DEPTH, 0]}
    >
      <meshStandardMaterial
        color="#1E6E95"
        roughness={0.15}
        metalness={0.35}
        transparent
        opacity={0.88}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/** Depth markings so the level has a readable reference, not just a height. */
function DepthGauge({ waterLevelFraction }: { waterLevelFraction: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  return (
    <group position={[BASIN_WIDTH / 2 + 0.08, 0, 0]}>
      <mesh position={[0, CHANNEL_DEPTH / 2, 0]}>
        <boxGeometry args={[0.02, CHANNEL_DEPTH, 0.02]} />
        <meshStandardMaterial color="#D9D4C6" roughness={0.7} />
      </mesh>
      {ticks.map((tick) => (
        <mesh key={tick} position={[0.045, tick * CHANNEL_DEPTH, 0]}>
          <boxGeometry args={[0.07, 0.006, 0.006]} />
          <meshBasicMaterial color={tick <= waterLevelFraction ? '#7DD3FC' : '#6E6A60'} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

export default function WaterScene({
  rainfallMmPerHour,
  waterLevelFraction,
  dischargeCumecs,
  dischargeScaleCumecs = null,
  levelProvenance,
}: Props) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2.2, 3.4, 2]} intensity={1.35} color="#E8F4FA" />
      <directionalLight position={[-2, 1, -2]} intensity={0.3} color="#8CA8B5" />

      {/* Channel bed and walls, giving the level something to be measured against. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[BASIN_WIDTH, BASIN_DEPTH]} />
        <meshStandardMaterial color="#2A3A33" roughness={1} />
      </mesh>
      {([-1, 1] as const).map((side) => (
        <mesh key={side} position={[0, CHANNEL_DEPTH / 2, (side * BASIN_DEPTH) / 2]}>
          <boxGeometry args={[BASIN_WIDTH, CHANNEL_DEPTH, 0.03]} />
          <meshStandardMaterial color="#3A4A43" roughness={0.9} transparent opacity={0.55} />
        </mesh>
      ))}

      <WaterSurface
        waterLevelFraction={waterLevelFraction}
        dischargeCumecs={dischargeCumecs}
        dischargeScaleCumecs={dischargeScaleCumecs}
      />
      <DepthGauge waterLevelFraction={waterLevelFraction} />
      {rainfallMmPerHour !== null && rainfallMmPerHour > 0 && <Rain rainfallMmPerHour={rainfallMmPerHour} />}

      {/* Marker ring tinting the scene by where the level figure came from. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <ringGeometry args={[BASIN_DEPTH * 0.72, BASIN_DEPTH * 0.76, 48]} />
        <meshBasicMaterial
          color={levelProvenance === 'observed' ? '#64816C' : '#6E6A60'}
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>

      <OrbitControls enableZoom enablePan maxPolarAngle={Math.PI * 0.49} minDistance={1.4} maxDistance={6} />
    </>
  )
}
