import { useMemo, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  BELT_LENGTH_M,
  CLASSIFIER_POSITION_M,
  MATERIAL_COLOUR,
  diverterAssignments,
  diverterPosition,
  type Material,
  type WasteState,
} from '../../simulation/engines/waste.ts'

/**
 * Materials recovery facility.
 *
 * Every item drawn is an item the simulation is actually tracking: its
 * position along the belt is the engine's `x`, its colour is its true
 * material, and it leaves the belt at the moment the engine diverts it. The
 * effector arms swing when the engine records a pick, and the bin fill levels
 * are the engine's accumulated masses.
 *
 * The building, lighting and belt structure are scenery.
 */

interface Props {
  state: WasteState
  beltSpeedMps: number
  diverterCount: number
  /** Bin masses, keyed by material, for the fill indicators. */
  binKg: Record<Material, number>
  /** Mass at which a bin reads as full, for the fill bars. */
  binCapacityKg: number
  running: boolean
}

/** Scene units per metre. The belt is 12 m and should span the viewport. */
const SCALE = 0.26
const BELT_WIDTH = 1.0
const BELT_HEIGHT = 0.52

function beltX(metres: number): number {
  return (metres - BELT_LENGTH_M / 2) * SCALE
}

// ── Structure ──────────────────────────────────────────────────────────────

function Facility() {
  const legs = useMemo(() => {
    const positions: number[] = []
    for (let metre = 0.5; metre < BELT_LENGTH_M; metre += 2) positions.push(metre)
    return positions
  }, [])

  return (
    <group>
      {/* Concrete floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow={false}>
        <planeGeometry args={[9, 6]} />
        <meshStandardMaterial color="#4A4A48" roughness={0.95} metalness={0.02} />
      </mesh>
      <gridHelper args={[9, 18, '#565654', '#4F4F4D']} position={[0, 0.002, 0]} />

      {/* Belt deck — brushed metal */}
      <mesh position={[0, BELT_HEIGHT, 0]}>
        <boxGeometry args={[BELT_LENGTH_M * SCALE, 0.05, BELT_WIDTH]} />
        <meshStandardMaterial color="#6E7276" roughness={0.35} metalness={0.75} />
      </mesh>
      {/* Side rails */}
      {([-1, 1] as const).map((side) => (
        <mesh key={side} position={[0, BELT_HEIGHT + 0.07, (side * BELT_WIDTH) / 2]}>
          <boxGeometry args={[BELT_LENGTH_M * SCALE, 0.09, 0.035]} />
          <meshStandardMaterial color="#8A9096" roughness={0.3} metalness={0.8} />
        </mesh>
      ))}
      {/* Support legs */}
      {legs.map((metre) => (
        <mesh key={metre} position={[beltX(metre), BELT_HEIGHT / 2, 0]}>
          <boxGeometry args={[0.05, BELT_HEIGHT, 0.05]} />
          <meshStandardMaterial color="#55595C" roughness={0.5} metalness={0.6} />
        </mesh>
      ))}

      {/* Classification gantry */}
      <group position={[beltX(CLASSIFIER_POSITION_M), 0, 0]}>
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[0, BELT_HEIGHT + 0.28, (side * BELT_WIDTH) / 2 + side * 0.08]}>
            <boxGeometry args={[0.05, 0.56, 0.05]} />
            <meshStandardMaterial color="#8A9096" roughness={0.35} metalness={0.7} />
          </mesh>
        ))}
        <mesh position={[0, BELT_HEIGHT + 0.56, 0]}>
          <boxGeometry args={[0.09, 0.07, BELT_WIDTH + 0.22]} />
          <meshStandardMaterial color="#3E4347" roughness={0.4} metalness={0.6} />
        </mesh>
        {/* Sensor bar glow — marks where classification happens. */}
        <mesh position={[0, BELT_HEIGHT + 0.5, 0]}>
          <boxGeometry args={[0.012, 0.012, BELT_WIDTH]} />
          <meshBasicMaterial color="#7DD3FC" toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

// ── Belt items ─────────────────────────────────────────────────────────────

function BeltItems({ state }: { state: WasteState }) {
  // Items are short-lived and typically number in the tens, so individual
  // meshes stay cheaper than maintaining instanced buffers across frames.
  return (
    <group>
      {state.items.map((item) => {
        const diverted = item.divertedTo !== null
        const x = beltX(Math.min(item.x, BELT_LENGTH_M))
        // A diverted item lifts and slides sideways toward its bin.
        const pickProgress = diverted ? Math.min((item.x - diverterPosition(0)) * 1.4, 1) : 0
        const y = BELT_HEIGHT + 0.07 + pickProgress * 0.32
        const z = item.lane * 0.3 + (diverted ? pickProgress * 1.1 : 0)

        return (
          <mesh key={item.id} position={[x, y, z]} rotation={[item.lane, item.x * 0.6, 0]}>
            <boxGeometry args={[0.075, 0.055, 0.075]} />
            <meshStandardMaterial
              color={MATERIAL_COLOUR[item.material]}
              roughness={item.material === 'glass' ? 0.1 : 0.7}
              metalness={item.material === 'metal' ? 0.85 : 0.05}
              transparent={item.material === 'glass'}
              opacity={item.material === 'glass' ? 0.72 : 1}
            />
          </mesh>
        )
      })}
    </group>
  )
}

// ── Effector arms ──────────────────────────────────────────────────────────

function EffectorArm({
  index,
  material,
  state,
}: {
  index: number
  material: Material
  state: WasteState
}) {
  const armRef = useRef<THREE.Group>(null)
  const position = diverterPosition(index)

  useFrame(() => {
    if (!armRef.current) return
    // Swing while the engine says this effector is occupied. The arm follows
    // the simulation; it is not on a timer of its own.
    const busyUntil = state.diverterBusyUntil[index] ?? 0
    const remaining = busyUntil - state.seconds
    const busy = remaining > 0
    const target = busy ? -0.9 : 0
    armRef.current.rotation.z += (target - armRef.current.rotation.z) * 0.25
  })

  return (
    <group position={[beltX(position), 0, BELT_WIDTH / 2 + 0.12]}>
      {/* Pedestal */}
      <mesh position={[0, BELT_HEIGHT * 0.55, 0]}>
        <cylinderGeometry args={[0.07, 0.09, BELT_HEIGHT * 1.1, 12]} />
        <meshStandardMaterial color="#4E5357" roughness={0.45} metalness={0.7} />
      </mesh>
      {/* Shoulder */}
      <group ref={armRef} position={[0, BELT_HEIGHT * 1.1, 0]}>
        <mesh position={[0, 0.16, -0.1]} rotation={[0.5, 0, 0]}>
          <boxGeometry args={[0.055, 0.36, 0.055]} />
          <meshStandardMaterial color={MATERIAL_COLOUR[material]} roughness={0.45} metalness={0.4} />
        </mesh>
        {/* Gripper */}
        <mesh position={[0, 0.3, -0.26]}>
          <boxGeometry args={[0.08, 0.05, 0.08]} />
          <meshStandardMaterial color="#2F3336" roughness={0.6} metalness={0.5} />
        </mesh>
      </group>
      {/* Stream label strip */}
      <mesh position={[0, 0.02, 0.26]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.3, 0.1]} />
        <meshBasicMaterial color={MATERIAL_COLOUR[material]} toneMapped={false} />
      </mesh>
    </group>
  )
}

// ── Collection bins ────────────────────────────────────────────────────────

function Bins({
  assignments,
  binKg,
  binCapacityKg,
}: {
  assignments: Material[]
  binKg: Record<Material, number>
  binCapacityKg: number
}) {
  return (
    <group>
      {assignments.map((material, index) => {
        const fill = Math.min((binKg[material] ?? 0) / Math.max(binCapacityKg, 0.001), 1)
        const x = beltX(diverterPosition(index))
        return (
          <group key={material} position={[x, 0, BELT_WIDTH / 2 + 1.05]}>
            {/* Bin shell */}
            <mesh position={[0, 0.17, 0]}>
              <boxGeometry args={[0.42, 0.34, 0.42]} />
              <meshStandardMaterial
                color="#3A3E41"
                roughness={0.8}
                metalness={0.15}
                transparent
                opacity={0.45}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* Accumulated material — height is the engine's recorded mass. */}
            {fill > 0.001 && (
              <mesh position={[0, 0.02 + (fill * 0.3) / 2, 0]}>
                <boxGeometry args={[0.37, fill * 0.3, 0.37]} />
                <meshStandardMaterial color={MATERIAL_COLOUR[material]} roughness={0.75} />
              </mesh>
            )}
            {/* Colour band identifying the stream */}
            <mesh position={[0, 0.345, 0]}>
              <boxGeometry args={[0.44, 0.03, 0.44]} />
              <meshBasicMaterial color={MATERIAL_COLOUR[material]} toneMapped={false} />
            </mesh>
          </group>
        )
      })}

      {/* Residual line at the end of the belt */}
      <group position={[beltX(BELT_LENGTH_M) + 0.25, 0, 0]}>
        <mesh position={[0, 0.17, 0]}>
          <boxGeometry args={[0.42, 0.34, 0.5]} />
          <meshStandardMaterial color="#2E3133" roughness={0.9} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.345, 0]}>
          <boxGeometry args={[0.44, 0.03, 0.52]} />
          <meshBasicMaterial color="#6E6A60" toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

/** Belt tread motion, so a running line reads as running. */
function BeltMotion({ speed, running }: { speed: number; running: boolean }) {
  const groupRef = useRef<THREE.Group>(null)
  const offset = useRef(0)
  const treadSpacing = 0.18

  useFrame((_, delta) => {
    if (!groupRef.current) return
    if (running) offset.current = (offset.current + speed * SCALE * delta) % treadSpacing
    groupRef.current.position.x = offset.current
  })

  const treads = useMemo(() => {
    const items: number[] = []
    const span = BELT_LENGTH_M * SCALE
    for (let x = -span / 2; x < span / 2; x += treadSpacing) items.push(x)
    return items
  }, [])

  return (
    <group ref={groupRef}>
      {treads.map((x) => (
        <mesh key={x} position={[x, BELT_HEIGHT + 0.027, 0]}>
          <boxGeometry args={[0.012, 0.004, BELT_WIDTH - 0.06]} />
          <meshStandardMaterial color="#565B5F" roughness={0.6} metalness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

export default function WasteFacilityScene({
  state,
  beltSpeedMps,
  diverterCount,
  binKg,
  binCapacityKg,
  running,
}: Props) {
  const assignments = useMemo(() => diverterAssignments(diverterCount), [diverterCount])

  return (
    <>
      {/* Neutral industrial lighting — high fill, low drama. */}
      <ambientLight intensity={0.62} />
      <directionalLight position={[2.5, 4, 2]} intensity={1.1} color="#F2F4F2" />
      <directionalLight position={[-2.5, 2.5, -2]} intensity={0.4} color="#C8D4DA" />
      {/* Overhead bay fixtures */}
      {[-1.6, 0, 1.6].map((x) => (
        <pointLight key={x} position={[x, 2.2, 0]} intensity={1.6} distance={5} color="#E8F0EE" />
      ))}

      <Facility />
      <BeltMotion speed={beltSpeedMps} running={running} />
      <BeltItems state={state} />
      {assignments.map((material, index) => (
        <EffectorArm key={material} index={index} material={material} state={state} />
      ))}
      <Bins assignments={assignments} binKg={binKg} binCapacityKg={binCapacityKg} />

      <OrbitControls
        enableZoom
        enablePan
        maxPolarAngle={Math.PI * 0.49}
        minDistance={1.6}
        maxDistance={9}
        target={[0, 0.4, 0.3]}
      />
    </>
  )
}
