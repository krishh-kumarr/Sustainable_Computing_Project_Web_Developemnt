import { useMemo, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Server hall visualising the data-centre model's inputs and outputs.
 *
 * Every visual here is driven by a model input or a calculated result — there
 * is no measured facility telemetry behind any of it, and the legend says so:
 *
 *   - lit rack units follow the modelled fleet utilisation;
 *   - activity-light flicker rate follows utilisation;
 *   - the cooling airflow particles scale with the cooling-overhead fraction;
 *   - the hall's tint follows the renewable supply share.
 */

interface Props {
  /** Modelled mean fleet utilisation, 0–100 %. */
  utilisationPercent: number
  /** Cooling and distribution overhead as a fraction of IT load. */
  coolingOverheadFraction: number
  /** Renewable supply share, 0–100 %. */
  renewablePercent: number
  /** Modelled server count — sets how many racks are drawn (capped). */
  serverCount: number
  /** Observed main-thread load of this browser tab, 0–1. Shown as one marker. */
  browserMainThreadLoad?: number | null
}

const RACK_UNITS = 10

function Rack({
  position,
  utilisationPercent,
  seed,
}: {
  position: [number, number, number]
  utilisationPercent: number
  seed: number
}) {
  const litCount = Math.round((Math.min(Math.max(utilisationPercent, 0), 100) / 100) * RACK_UNITS)
  const lightsRef = useRef<THREE.Group>(null)

  useFrame(({ clock }) => {
    if (!lightsRef.current) return
    const t = clock.getElapsedTime()
    // Flicker frequency rises with utilisation: a busier node blinks more.
    const frequency = 1 + (utilisationPercent / 100) * 7
    lightsRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh
      const material = mesh.material as THREE.MeshBasicMaterial
      const pulse = 0.45 + 0.55 * Math.abs(Math.sin(t * frequency + seed + i * 1.3))
      material.opacity = i < litCount ? pulse : 0.07
    })
  })

  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[0.3, 0.72, 0.42]} />
        <meshStandardMaterial color="#2E3832" roughness={0.45} metalness={0.5} />
      </mesh>
      <group ref={lightsRef}>
        {Array.from({ length: RACK_UNITS }, (_, unit) => (
          <mesh key={unit} position={[0.152, -0.31 + unit * 0.068, 0]}>
            <boxGeometry args={[0.012, 0.03, 0.3]} />
            <meshBasicMaterial color="#8ED2A8" transparent opacity={0.1} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function Airflow({ coolingOverheadFraction }: { coolingOverheadFraction: number }) {
  const pointsRef = useRef<THREE.Points>(null)
  // More overhead means more air being moved.
  const count = Math.min(Math.round(150 + coolingOverheadFraction * 900), 1600)
  const speed = 0.35 + coolingOverheadFraction * 0.9

  const positions = useMemo(() => {
    const array = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      array[i * 3] = (Math.random() - 0.5) * 2.6
      array[i * 3 + 1] = Math.random() * 1.4 - 0.5
      array[i * 3 + 2] = (Math.random() - 0.5) * 1.6
    }
    return array
  }, [count])

  useFrame((_, delta) => {
    const geometry = pointsRef.current?.geometry
    if (!geometry) return
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
    const array = attribute.array as Float32Array
    for (let i = 0; i < array.length; i += 3) {
      array[i + 1] += speed * delta
      if (array[i + 1] > 0.95) {
        array[i + 1] = -0.5
        array[i] = (Math.random() - 0.5) * 2.6
        array[i + 2] = (Math.random() - 0.5) * 1.6
      }
    }
    attribute.needsUpdate = true
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.014} color="#9FC8D8" transparent opacity={0.3} sizeAttenuation />
    </points>
  )
}

export default function DataCentreScene({
  utilisationPercent,
  coolingOverheadFraction,
  renewablePercent,
  serverCount,
  browserMainThreadLoad = null,
}: Props) {
  // Racks drawn are a visual sample of the modelled fleet, not one per server.
  const rackCount = Math.min(Math.max(Math.round(serverCount / 40), 4), 24)

  const racks = useMemo(() => {
    const perRow = Math.ceil(rackCount / 2)
    return Array.from({ length: rackCount }, (_, i) => {
      const row = i < perRow ? 0 : 1
      const column = i % perRow;
      return {
        position: [
          (column / Math.max(perRow - 1, 1) - 0.5) * 2.3,
          0,
          row === 0 ? -0.42 : 0.42,
        ] as [number, number, number],
        seed: i * 0.7,
      }
    })
  }, [rackCount])

  // Tint from renewable share: sage for clean supply, warm for carbon-heavy.
  const fillColour = useMemo(() => {
    const t = Math.min(Math.max(renewablePercent, 0), 100) / 100
    return new THREE.Color('#C39A62').lerp(new THREE.Color('#64816C'), t)
  }, [renewablePercent])

  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[2, 3, 2]} intensity={0.9} color="#E8EFEA" />
      <pointLight position={[0, 1.4, 0]} intensity={2.2} color={fillColour} distance={5} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.37, 0]}>
        <planeGeometry args={[3.6, 2.4]} />
        <meshStandardMaterial color="#1C221F" roughness={0.9} metalness={0.2} />
      </mesh>
      <gridHelper args={[3.2, 14, '#2A322D', '#242B27']} position={[0, -0.368, 0]} />

      {racks.map((rack, i) => (
        <Rack key={i} position={rack.position} utilisationPercent={utilisationPercent} seed={rack.seed} />
      ))}

      <Airflow coolingOverheadFraction={coolingOverheadFraction} />

      {/* A single marker for the one genuinely measured value in this module:
          this browser tab's own main-thread load. */}
      {browserMainThreadLoad !== null && (
        <group position={[0, 0.72, 0]}>
          <mesh>
            <torusGeometry args={[0.2, 0.012, 10, 48]} />
            <meshBasicMaterial color="#4A6356" toneMapped={false} transparent opacity={0.35} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry
              args={[0.2, 0.02, 10, 48, Math.max(browserMainThreadLoad, 0.02) * Math.PI * 2]}
            />
            <meshBasicMaterial color="#8ED2A8" toneMapped={false} />
          </mesh>
        </group>
      )}

      <OrbitControls enableZoom enablePan maxPolarAngle={Math.PI * 0.52} minDistance={1.4} maxDistance={6} />
    </>
  )
}
