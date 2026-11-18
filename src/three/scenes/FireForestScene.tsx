import { useEffect, useMemo, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BURNED, BURNING, type FireGrid } from '../../simulation/models/fireSpread.ts'
import { GRID_HEIGHT, GRID_WIDTH } from '../../simulation/engines/forest.ts'
import type { FireDetection } from '../../services/api/nasaFirms'
import type { Occurrence } from '../../services/api/gbif'

/**
 * Forest with live fire propagation.
 *
 * Two distinct kinds of thing are drawn here, and the scene keeps them
 * visually separate on purpose:
 *
 *  - **Simulated fire** — the cellular automaton's grid, rendered as burning
 *    and burned ground plus smoke columns. Hypothetical, driven by the
 *    conditions you set.
 *  - **Satellite detections** — NASA FIRMS thermal anomalies at their real
 *    coordinates, drawn as elevated markers well above the canopy so they can
 *    never be mistaken for the simulation.
 *
 * Trees are instanced: 2 500 of them in three draw calls rather than 7 500.
 * Their positions follow the engine's own fuel field, so a gap in the forest
 * is a gap in the fuel bed, and the fire stops there for a visible reason.
 */

interface Props {
  grid: FireGrid
  /** Half-width of the plotted area in degrees, matching the data query. */
  spanDegrees: number
  centre: { latitude: number; longitude: number }
  detections: FireDetection[]
  occurrences: Occurrence[]
  windDirectionDeg: number
  windSpeedKmh: number
  /** Pauses smoke and flame animation for reduced-motion users. */
  animate?: boolean
}

/** Scene extent in world units; the grid maps onto this square. */
const EXTENT = 2.2

function cellToWorld(x: number, y: number): [number, number] {
  return [
    ((x + 0.5) / GRID_WIDTH - 0.5) * EXTENT * 2,
    ((y + 0.5) / GRID_HEIGHT - 0.5) * EXTENT * 2,
  ]
}

// ── Terrain ────────────────────────────────────────────────────────────────

function Terrain() {
  // Gentle deterministic relief, purely for depth. The fire model is flat:
  // there is no slope term, and the legend says so.
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(EXTENT * 2.2, EXTENT * 2.2, 48, 48)
    const position = plane.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const y = position.getY(i)
      position.setZ(i, Math.sin(x * 1.1) * 0.05 + Math.cos(y * 0.9) * 0.04)
    }
    plane.computeVertexNormals()
    return plane
  }, [])

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
      <meshStandardMaterial color="#2A3426" roughness={1} />
    </mesh>
  )
}

// ── Instanced canopy ───────────────────────────────────────────────────────

function Canopy({ grid }: { grid: FireGrid }) {
  const trunkRef = useRef<THREE.InstancedMesh>(null)
  const foliageRef = useRef<THREE.InstancedMesh>(null)

  // Tree placement comes from the engine's fuel field, so the forest the user
  // sees is literally the fuel bed the model is burning.
  const trees = useMemo(() => {
    const items: { x: number; z: number; height: number; index: number; tint: number }[] = []
    // Sub-sample: one tree per 1.5 cells keeps the count manageable while
    // still reading as continuous forest.
    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const index = y * GRID_WIDTH + x
        if (grid.fuel[index] <= 0) continue
        if ((x + y) % 2 === 1) continue
        const [wx, wz] = cellToWorld(x, y)
        // Deterministic jitter from the cell index, so trees never shimmer.
        const jitterX = (((index * 2654435761) >>> 0) % 1000) / 1000 - 0.5
        const jitterZ = (((index * 1597334677) >>> 0) % 1000) / 1000 - 0.5
        items.push({
          x: wx + jitterX * 0.05,
          z: wz + jitterZ * 0.05,
          height: 0.1 + grid.fuel[index] * 0.16,
          index,
          tint: (((index * 374761393) >>> 0) % 100) / 100,
        })
      }
    }
    return items
  }, [grid.fuel])

  const colours = useMemo(() => new Float32Array(trees.length * 3), [trees.length])

  // Recolour trees as their cell burns. Done per frame against the live grid,
  // which is what makes the forest visibly change rather than just the ground.
  useFrame(() => {
    const foliage = foliageRef.current
    if (!foliage) return
    const colour = new THREE.Color()
    let changed = false
    trees.forEach((tree, i) => {
      const cell = grid.state[tree.index]
      if (cell === BURNING) colour.setHex(0xd9541f)
      else if (cell === BURNED) colour.setHex(0x37322c)
      else colour.setRGB(0.17 + tree.tint * 0.08, 0.3 + tree.tint * 0.1, 0.2 + tree.tint * 0.06)
      const offset = i * 3
      if (
        colours[offset] !== colour.r ||
        colours[offset + 1] !== colour.g ||
        colours[offset + 2] !== colour.b
      ) {
        colours[offset] = colour.r
        colours[offset + 1] = colour.g
        colours[offset + 2] = colour.b
        changed = true
      }
    })
    if (changed && foliage.instanceColor) foliage.instanceColor.needsUpdate = true
  })

  useEffect(() => {
    const trunk = trunkRef.current
    const foliage = foliageRef.current
    if (!trunk || !foliage) return
    const matrix = new THREE.Matrix4()
    trees.forEach((tree, i) => {
      matrix.makeScale(1, tree.height / 0.16, 1)
      matrix.setPosition(tree.x, tree.height * 0.3, tree.z)
      trunk.setMatrixAt(i, matrix)
      matrix.makeScale(tree.height / 0.16, tree.height / 0.16, tree.height / 0.16)
      matrix.setPosition(tree.x, tree.height * 0.85, tree.z)
      foliage.setMatrixAt(i, matrix)
    })
    trunk.instanceMatrix.needsUpdate = true
    foliage.instanceMatrix.needsUpdate = true
    foliage.computeBoundingSphere()
    trunk.computeBoundingSphere()
  }, [trees])

  if (trees.length === 0) return null

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, trees.length]}>
        <cylinderGeometry args={[0.006, 0.01, 0.16, 4]} />
        <meshStandardMaterial color="#4A3A2A" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={foliageRef} args={[undefined, undefined, trees.length]}>
        <coneGeometry args={[0.055, 0.16, 6]} />
        <meshStandardMaterial roughness={0.95} vertexColors />
        <instancedBufferAttribute attach="instanceColor" args={[colours, 3]} />
      </instancedMesh>
    </group>
  )
}

// ── Fire ground state ──────────────────────────────────────────────────────

function FireGround({ grid }: { grid: FireGrid }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const count = GRID_WIDTH * GRID_HEIGHT
  const colours = useMemo(() => new Float32Array(count * 3), [count])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const cellSize = (EXTENT * 2) / GRID_WIDTH
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const [wx, wz] = cellToWorld(x, y)
        matrix.makeScale(cellSize * 0.96, 1, cellSize * 0.96)
        matrix.setPosition(wx, 0.004, wz)
        mesh.setMatrixAt(y * GRID_WIDTH + x, matrix)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [])

  useFrame(({ clock }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const flicker = 0.75 + 0.25 * Math.sin(clock.getElapsedTime() * 7)
    const colour = new THREE.Color()
    for (let i = 0; i < count; i++) {
      const cell = grid.state[i]
      if (cell === BURNING) colour.setRGB(1 * flicker, 0.33 * flicker, 0.08)
      else if (cell === BURNED) colour.setRGB(0.1, 0.09, 0.08)
      else if (grid.fuel[i] > 0) colour.setRGB(0.12, 0.17, 0.11)
      else colour.setRGB(0.22, 0.2, 0.16)
      colours[i * 3] = colour.r
      colours[i * 3 + 1] = colour.g
      colours[i * 3 + 2] = colour.b
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial vertexColors side={THREE.DoubleSide} toneMapped={false} />
      <instancedBufferAttribute attach="instanceColor" args={[colours, 3]} />
    </instancedMesh>
  )
}

// ── Smoke ──────────────────────────────────────────────────────────────────

function Smoke({
  grid,
  windDirectionDeg,
  windSpeedKmh,
  animate,
}: {
  grid: FireGrid
  windDirectionDeg: number
  windSpeedKmh: number
  animate: boolean
}) {
  const pointsRef = useRef<THREE.Points>(null)
  const count = 900
  const positions = useMemo(() => new Float32Array(count * 3), [count])
  const ages = useMemo(() => new Float32Array(count), [count])

  // Wind blows TOWARD (direction + 180) in meteorological convention.
  const drift = useMemo(() => {
    const towardRad = (((windDirectionDeg + 180) % 360) * Math.PI) / 180
    const speed = (windSpeedKmh / 60) * 0.5
    return { x: Math.sin(towardRad) * speed, z: -Math.cos(towardRad) * speed }
  }, [windDirectionDeg, windSpeedKmh])

  useFrame((_, delta) => {
    const geometry = pointsRef.current?.geometry
    if (!geometry) return
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
    const array = attribute.array as Float32Array
    const step = animate ? Math.min(delta, 0.05) : 0

    // Collect burning cells once per frame to respawn particles over.
    const burning: number[] = []
    for (let i = 0; i < grid.state.length; i++) if (grid.state[i] === BURNING) burning.push(i)

    for (let i = 0; i < count; i++) {
      ages[i] -= step
      if (ages[i] <= 0 || array[i * 3 + 1] > 1.6) {
        if (burning.length === 0) {
          // Nothing burning: park particles below the floor so they vanish.
          array[i * 3 + 1] = -5
          continue
        }
        const cell = burning[(i * 7919) % burning.length]
        const [wx, wz] = cellToWorld(cell % GRID_WIDTH, Math.floor(cell / GRID_WIDTH))
        array[i * 3] = wx
        array[i * 3 + 1] = 0.05
        array[i * 3 + 2] = wz
        ages[i] = 2 + ((i % 10) / 10) * 2
      } else {
        array[i * 3] += drift.x * step
        array[i * 3 + 1] += (0.35 + (i % 5) * 0.04) * step
        array[i * 3 + 2] += drift.z * step
      }
    }
    attribute.needsUpdate = true
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.09} color="#8C8782" transparent opacity={0.3} sizeAttenuation depthWrite={false} />
    </points>
  )
}

// ── Real satellite detections, kept visually distinct ──────────────────────

function SatelliteDetections({
  detections,
  centre,
  spanDegrees,
}: Pick<Props, 'detections' | 'centre' | 'spanDegrees'>) {
  const points = useMemo(() => {
    const maxFrp = Math.max(...detections.map((d) => d.frpMegawatts ?? 0), 1)
    return detections
      .map((detection) => {
        const dx = (detection.longitude - centre.longitude) / spanDegrees
        const dz = -(detection.latitude - centre.latitude) / spanDegrees
        if (Math.abs(dx) > 1.02 || Math.abs(dz) > 1.02) return null
        const frp = detection.frpMegawatts
        const relative = frp !== null && frp > 0 ? Math.log1p(frp) / Math.log1p(maxFrp) : 0
        return {
          key: `${detection.latitude}-${detection.longitude}-${detection.acquisitionTime}`,
          x: dx * EXTENT,
          z: dz * EXTENT,
          size: 0.018 + relative * 0.035,
          confidence: detection.confidenceClass,
        }
      })
      .filter((point): point is NonNullable<typeof point> => point !== null)
  }, [detections, centre, spanDegrees])

  const colourFor = (confidence: FireDetection['confidenceClass']) =>
    confidence === 'high' ? '#FF6B4A' : confidence === 'nominal' ? '#FFA04A' : '#FFD88A'

  return (
    <group>
      {points.map((point) => (
        <group key={point.key} position={[point.x, 0, point.z]}>
          {/* Elevated marker on a stalk — deliberately above the canopy, so a
              real measurement is never confused with the simulated fire. */}
          <mesh position={[0, 0.55, 0]}>
            <octahedronGeometry args={[point.size, 0]} />
            <meshBasicMaterial color={colourFor(point.confidence)} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.28, 0]}>
            <cylinderGeometry args={[0.0025, 0.0025, 0.56, 4]} />
            <meshBasicMaterial color={colourFor(point.confidence)} transparent opacity={0.45} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function BiodiversityPoints({
  occurrences,
  centre,
  spanDegrees,
}: Pick<Props, 'occurrences' | 'centre' | 'spanDegrees'>) {
  const geometry = useMemo(() => {
    const coordinates: number[] = []
    for (const record of occurrences) {
      const dx = (record.longitude - centre.longitude) / spanDegrees
      const dz = -(record.latitude - centre.latitude) / spanDegrees
      if (Math.abs(dx) > 1.02 || Math.abs(dz) > 1.02) continue
      coordinates.push(dx * EXTENT, 0.26, dz * EXTENT)
    }
    return new Float32Array(coordinates)
  }, [occurrences, centre, spanDegrees])

  if (geometry.length === 0) return null

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geometry, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.03} color="#BFD9C4" transparent opacity={0.8} sizeAttenuation toneMapped={false} />
    </points>
  )
}

export default function FireForestScene({
  grid,
  spanDegrees,
  centre,
  detections,
  occurrences,
  windDirectionDeg,
  windSpeedKmh,
  animate = true,
}: Props) {
  // Burning cells light the scene, so a growing fire visibly changes the mood.
  const fireIntensity = useMemo(() => {
    let burning = 0
    for (let i = 0; i < grid.state.length; i++) if (grid.state[i] === BURNING) burning++
    return Math.min(burning / 60, 3)
  }, [grid.state])

  return (
    <>
      <ambientLight intensity={0.42} />
      <directionalLight position={[2.6, 3.4, 1.6]} intensity={1.25} color="#FFEFD0" />
      <directionalLight position={[-2, 1.2, -2.4]} intensity={0.22} color="#8CA8B5" />
      {fireIntensity > 0.05 && (
        <pointLight position={[0, 0.6, 0]} intensity={fireIntensity * 2.2} distance={4} color="#FF7A33" />
      )}

      <Terrain />
      <FireGround grid={grid} />
      <Canopy grid={grid} />
      <Smoke grid={grid} windDirectionDeg={windDirectionDeg} windSpeedKmh={windSpeedKmh} animate={animate} />
      <BiodiversityPoints occurrences={occurrences} centre={centre} spanDegrees={spanDegrees} />
      <SatelliteDetections detections={detections} centre={centre} spanDegrees={spanDegrees} />

      <OrbitControls enableZoom enablePan maxPolarAngle={Math.PI * 0.48} minDistance={1.2} maxDistance={8} />
    </>
  )
}
