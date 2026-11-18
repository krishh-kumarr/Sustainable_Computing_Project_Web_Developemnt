import { useMemo, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Farm scene driven by observed and forecast agronomic variables.
 *
 * Data connections, each named in the legend:
 *   - soil moisture (volumetric fraction, 0–7 cm layer) sets the soil colour;
 *   - solar irradiance sets the key-light intensity and warmth;
 *   - rainfall intensity sets the rain particles;
 *   - wind speed sets how far the crop canopy sways.
 *
 * Crop height and colour are NOT data. No source tells us what is planted here
 * or how it is growing, so the canopy is a fixed, uniform stand and the legend
 * says so. Nothing in this scene is a yield indicator.
 */

interface Props {
  /** Volumetric soil water content, m³/m³, 0–7 cm layer. */
  soilMoistureFraction: number | null
  /** Daily solar irradiance, kWh/m²/day. */
  irradianceKwhPerM2Day: number | null
  /** Rainfall intensity, mm/h. */
  rainfallMmPerHour: number | null
  /** Wind speed, km/h. */
  windSpeedKmh: number | null
  /** Is it daytime at the location? */
  isDay?: boolean | null
}

const FIELD_WIDTH = 3.0
const FIELD_DEPTH = 2.2
const ROWS = 14
const PER_ROW = 20

function Soil({ soilMoistureFraction }: { soilMoistureFraction: number | null }) {
  // Dry mineral soil reads pale and warm; wet soil reads dark and cool. The
  // legend states the fraction range the ramp covers (0.05–0.40 m³/m³).
  const colour = useMemo(() => {
    if (soilMoistureFraction === null) return new THREE.Color('#5A5248')
    const t = Math.min(Math.max((soilMoistureFraction - 0.05) / 0.35, 0), 1)
    return new THREE.Color('#A08E6E').lerp(new THREE.Color('#3A3026'), t)
  }, [soilMoistureFraction])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[FIELD_WIDTH, FIELD_DEPTH, 48, 36]} />
        <meshStandardMaterial color={colour} roughness={1} />
      </mesh>
      {/* Tilled furrows, for depth cueing only. */}
      {Array.from({ length: ROWS }, (_, row) => (
        <mesh
          key={row}
          position={[0, 0.004, (row / (ROWS - 1) - 0.5) * FIELD_DEPTH]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[FIELD_WIDTH, 0.015]} />
          <meshStandardMaterial color={colour.clone().multiplyScalar(0.7)} roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

function Canopy({ windSpeedKmh }: { windSpeedKmh: number | null }) {
  // Sway amplitude and frequency both rise with wind speed.
  const sway = windSpeedKmh === null ? 0.02 : Math.min(0.02 + (windSpeedKmh / 60) * 0.16, 0.2)
  const frequency = windSpeedKmh === null ? 0.8 : 0.8 + Math.min(windSpeedKmh / 25, 2.2)

  const plants = useMemo(() => {
    const items: { x: number; z: number; phase: number }[] = []
    for (let row = 0; row < ROWS; row++) {
      for (let column = 0; column < PER_ROW; column++) {
        items.push({
          x: (column / (PER_ROW - 1) - 0.5) * FIELD_WIDTH * 0.94,
          z: (row / (ROWS - 1) - 0.5) * FIELD_DEPTH * 0.9,
          phase: row * 0.4 + column * 0.22,
        })
      }
    }
    return items
  }, [])

  const matrices = useMemo(() => plants.map(() => new THREE.Matrix4()), [plants])
  const meshRef = useRef<THREE.InstancedMesh>(null)

  useFrame(({ clock }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const t = clock.getElapsedTime()
    plants.forEach((plant, i) => {
      const lean = Math.sin(t * frequency + plant.phase) * sway
      const matrix = matrices[i]
      matrix.makeRotationZ(lean)
      matrix.setPosition(plant.x, 0.09, plant.z)
      mesh.setMatrixAt(i, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, plants.length]} castShadow={false}>
      <cylinderGeometry args={[0.008, 0.014, 0.18, 5]} />
      <meshStandardMaterial color="#6E8F3A" roughness={0.9} />
    </instancedMesh>
  )
}

function Rain({ rainfallMmPerHour }: { rainfallMmPerHour: number }) {
  const pointsRef = useRef<THREE.Points>(null)
  const count = Math.min(Math.round(80 + rainfallMmPerHour * 200), 2400)
  const fallSpeed = 1 + Math.min(rainfallMmPerHour, 25) * 0.1

  const positions = useMemo(() => {
    const array = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      array[i * 3] = (Math.random() - 0.5) * FIELD_WIDTH
      array[i * 3 + 1] = Math.random() * 2
      array[i * 3 + 2] = (Math.random() - 0.5) * FIELD_DEPTH
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
      if (array[i + 1] < 0.02) {
        array[i + 1] = 2
        array[i] = (Math.random() - 0.5) * FIELD_WIDTH
        array[i + 2] = (Math.random() - 0.5) * FIELD_DEPTH
      }
    }
    attribute.needsUpdate = true
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.013} color="#C7E4F2" transparent opacity={0.6} sizeAttenuation />
    </points>
  )
}

export default function FarmScene({
  soilMoistureFraction,
  irradianceKwhPerM2Day,
  rainfallMmPerHour,
  windSpeedKmh,
  isDay = null,
}: Props) {
  /**
   * Key-light intensity from daily irradiance. 7 kWh/m²/day is near the global
   * clear-sky maximum for a horizontal surface, so it anchors the top of the
   * ramp. The legend states this.
   */
  const sunIntensity = useMemo(() => {
    if (irradianceKwhPerM2Day === null) return 1.2
    return 0.4 + Math.min(irradianceKwhPerM2Day / 7, 1.2) * 1.5
  }, [irradianceKwhPerM2Day])

  const sunColour = isDay === false ? '#9FB2C4' : '#FFF0CE'

  return (
    <>
      <ambientLight intensity={isDay === false ? 0.3 : 0.5} />
      <directionalLight position={[2.4, 3.2, 1.4]} intensity={sunIntensity} color={sunColour} />
      <directionalLight position={[-2, 1.2, -1.8]} intensity={0.22} color="#8CA8B5" />

      <Soil soilMoistureFraction={soilMoistureFraction} />
      <Canopy windSpeedKmh={windSpeedKmh} />
      {rainfallMmPerHour !== null && rainfallMmPerHour > 0 && <Rain rainfallMmPerHour={rainfallMmPerHour} />}

      <OrbitControls enableZoom enablePan maxPolarAngle={Math.PI * 0.48} minDistance={1.2} maxDistance={6} />
    </>
  )
}
