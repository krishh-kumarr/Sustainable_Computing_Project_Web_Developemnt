import { useMemo, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { FireDetection } from '../../services/api/nasaFirms'
import type { Occurrence } from '../../services/api/gbif'

/**
 * Forest scene plotting real geographic points.
 *
 * - Each ember marks one NASA FIRMS satellite fire detection, at its reported
 *   latitude/longitude, sized by Fire Radiative Power where FIRMS supplies it.
 * - Each pale point marks one GBIF biodiversity occurrence record, at its
 *   reported coordinates.
 *
 * The canopy is decorative: no dataset here says where individual trees stand.
 * The legend says that explicitly, so the trees are never read as data.
 */

interface Props {
  centre: { latitude: number; longitude: number }
  /** Half-width of the plotted area in degrees — must match the query box. */
  spanDegrees: number
  detections: FireDetection[]
  occurrences: Occurrence[]
  /** Observed conditions, used only for lighting and haze. */
  cloudCoverPercent?: number | null
  /** Observed relative humidity, 0–100 %. Drives ground-haze density. */
  relativeHumidityPercent?: number | null
}

/** Project lat/lon into the scene's XZ plane, normalised to the query box. */
function project(
  latitude: number,
  longitude: number,
  centre: { latitude: number; longitude: number },
  spanDegrees: number,
  extent: number,
): [number, number] | null {
  const dx = (longitude - centre.longitude) / spanDegrees
  const dz = -(latitude - centre.latitude) / spanDegrees
  if (Math.abs(dx) > 1.02 || Math.abs(dz) > 1.02) return null
  return [dx * extent, dz * extent]
}

const EXTENT = 2.1

function FireDetections({ detections, centre, spanDegrees }: Pick<Props, 'detections' | 'centre' | 'spanDegrees'>) {
  const groupRef = useRef<THREE.Group>(null)

  const points = useMemo(() => {
    // FRP spans orders of magnitude, so size on a log scale against the set's
    // own maximum. The legend states the max so the sizes can be read.
    const frpValues = detections.map((d) => d.frpMegawatts).filter((f): f is number => f !== null && f > 0)
    const maxFrp = frpValues.length > 0 ? Math.max(...frpValues) : null

    return detections
      .map((detection) => {
        const projected = project(detection.latitude, detection.longitude, centre, spanDegrees, EXTENT)
        if (!projected) return null
        const frp = detection.frpMegawatts
        const relative = frp !== null && maxFrp !== null && frp > 0 ? Math.log1p(frp) / Math.log1p(maxFrp) : 0
        return {
          key: `${detection.latitude}-${detection.longitude}-${detection.acquisitionTime}`,
          x: projected[0],
          z: projected[1],
          // Detections without FRP get the floor size, never a guessed value.
          radius: 0.022 + relative * 0.055,
          height: 0.06 + relative * 0.5,
          confidence: detection.confidenceClass,
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
  }, [detections, centre, spanDegrees])

  useFrame(({ clock }) => {
    if (!groupRef.current) return
    const t = clock.getElapsedTime()
    groupRef.current.children.forEach((child, i) => {
      // Flicker, so the detections read as active rather than as static pins.
      const scale = 1 + Math.sin(t * 3 + i * 0.7) * 0.12
      child.scale.setScalar(scale)
    })
  })

  const colourFor = (confidence: FireDetection['confidenceClass']) =>
    confidence === 'high' ? '#E8502A' : confidence === 'nominal' ? '#E8842A' : '#D9B06A'

  return (
    <group ref={groupRef}>
      {points.map((point) => (
        <group key={point.key} position={[point.x, 0, point.z]}>
          <mesh position={[0, point.radius, 0]}>
            <sphereGeometry args={[point.radius, 12, 12]} />
            <meshBasicMaterial color={colourFor(point.confidence)} toneMapped={false} />
          </mesh>
          {/* Vertical plume cue, scaled by the same FRP figure. */}
          <mesh position={[0, point.height / 2 + point.radius, 0]}>
            <cylinderGeometry args={[point.radius * 0.25, point.radius * 0.8, point.height, 8, 1, true]} />
            <meshBasicMaterial
              color={colourFor(point.confidence)}
              transparent
              opacity={0.3}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Occurrences({ occurrences, centre, spanDegrees }: Pick<Props, 'occurrences' | 'centre' | 'spanDegrees'>) {
  const geometry = useMemo(() => {
    const coordinates: number[] = []
    for (const record of occurrences) {
      const projected = project(record.latitude, record.longitude, centre, spanDegrees, EXTENT)
      if (!projected) continue
      coordinates.push(projected[0], 0.035, projected[1])
    }
    return new Float32Array(coordinates)
  }, [occurrences, centre, spanDegrees])

  if (geometry.length === 0) return null

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geometry, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.038} color="#BFD9C4" transparent opacity={0.85} sizeAttenuation toneMapped={false} />
    </points>
  )
}

/**
 * Decorative canopy. Positions come from a fixed pseudo-random sequence, not
 * from any dataset — stated in the legend so it is never read as tree data.
 */
function Canopy() {
  const trees = useMemo(() => {
    // Deterministic LCG, so the canopy is stable between renders.
    let seed = 20260101
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    return Array.from({ length: 160 }, () => ({
      x: (random() - 0.5) * EXTENT * 2,
      z: (random() - 0.5) * EXTENT * 2,
      height: 0.1 + random() * 0.16,
      tint: random(),
    }))
  }, [])

  return (
    <group>
      {trees.map((tree, i) => (
        <group key={i} position={[tree.x, 0, tree.z]}>
          <mesh position={[0, tree.height * 0.3, 0]}>
            <cylinderGeometry args={[0.006, 0.01, tree.height * 0.6, 5]} />
            <meshStandardMaterial color="#4A3A2A" roughness={1} />
          </mesh>
          <mesh position={[0, tree.height * 0.8, 0]}>
            <coneGeometry args={[tree.height * 0.42, tree.height * 1.1, 7]} />
            <meshStandardMaterial
              color={tree.tint > 0.5 ? '#2F4A36' : '#3A5A40'}
              roughness={0.95}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}

export default function ForestScene({
  centre,
  spanDegrees,
  detections,
  occurrences,
  cloudCoverPercent = null,
  relativeHumidityPercent = null,
}: Props) {
  const keyIntensity = 1.6 - (cloudCoverPercent ?? 0) / 100 * 0.8
  // Humid air reads as haze; this is a lighting cue from an observed value.
  const hazeOpacity = relativeHumidityPercent === null ? 0.05 : 0.02 + (relativeHumidityPercent / 100) * 0.12

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2.6, 3.4, 1.6]} intensity={keyIntensity} color="#FFF0D4" />
      <directionalLight position={[-2, 1.2, -2.4]} intensity={0.25} color="#8CA8B5" />

      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[EXTENT * 2.1, EXTENT * 2.1]} />
        <meshStandardMaterial color="#1E2A20" roughness={1} />
      </mesh>
      <gridHelper args={[EXTENT * 2, 8, '#2A3A2E', '#243229']} position={[0, 0.001, 0]} />

      <Canopy />
      <Occurrences occurrences={occurrences} centre={centre} spanDegrees={spanDegrees} />
      <FireDetections detections={detections} centre={centre} spanDegrees={spanDegrees} />

      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[EXTENT * 2.1, 1, EXTENT * 2.1]} />
        <meshBasicMaterial color="#9FB4A6" transparent opacity={hazeOpacity} depthWrite={false} />
      </mesh>

      <OrbitControls enableZoom enablePan maxPolarAngle={Math.PI * 0.48} minDistance={1.2} maxDistance={7} />
    </>
  )
}
