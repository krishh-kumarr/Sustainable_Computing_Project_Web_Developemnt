import { useMemo } from 'react'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { projectToMetres, type UrbanFabric } from '../../services/api/openStreetMap'

/**
 * Urban fabric built from actual OpenStreetMap geometry for the selected
 * location — real road centrelines, real building footprint positions, real
 * green-space polygons.
 *
 * Two things this scene deliberately does NOT do:
 *   - invent building heights. A box is raised only where OSM records
 *     `building:levels`; untagged footprints are drawn as flat plates in a
 *     distinct colour, and the legend says so.
 *   - imply traffic. Roads are coloured by their OSM classification, which is a
 *     mapped attribute, not by any flow or speed figure.
 */

/** Scene units per metre. 1/550 fits a ~2 km box in the default viewport. */
const SCALE = 1 / 550
/** Metres per OSM storey — the conventional planning figure. */
const METRES_PER_LEVEL = 3

const ROAD_STYLE: Record<string, { colour: string; width: number }> = {
  motorway: { colour: '#C25E3A', width: 0.030 },
  trunk: { colour: '#C39A62', width: 0.025 },
  primary: { colour: '#D9C08A', width: 0.021 },
  secondary: { colour: '#A9B6AE', width: 0.016 },
  tertiary: { colour: '#8E9A92', width: 0.012 },
}

interface Props {
  fabric: UrbanFabric
  centre: { lat: number; lon: number }
  /** Observed AQI, 0–500, used to tint the haze volume. Null → no haze. */
  airQualityIndex?: number | null
  /** Observed cloud cover, 0–100 %, dims the key light. */
  cloudCoverPercent?: number | null
}

function Roads({ fabric, centre }: { fabric: UrbanFabric; centre: { lat: number; lon: number } }) {
  const groups = useMemo(() => {
    const byClass = new Map<string, Float32Array[]>()
    for (const road of fabric.roads) {
      const style = ROAD_STYLE[road.classification]
      if (!style) continue
      const points = road.geometry.map((point) => {
        const { x, z } = projectToMetres(point, centre)
        return new THREE.Vector3(x * SCALE, 0.004, z * SCALE)
      })
      if (points.length < 2) continue
      // One flat buffer of consecutive segment endpoints, drawn as LineSegments.
      const positions = new Float32Array((points.length - 1) * 6)
      for (let i = 0; i < points.length - 1; i++) {
        positions.set([points[i].x, points[i].y, points[i].z], i * 6)
        positions.set([points[i + 1].x, points[i + 1].y, points[i + 1].z], i * 6 + 3)
      }
      const bucket = byClass.get(road.classification) ?? []
      bucket.push(positions)
      byClass.set(road.classification, bucket)
    }

    // Merge each class into a single geometry — one draw call per road class.
    return [...byClass.entries()].map(([classification, buffers]) => {
      const total = buffers.reduce((sum, b) => sum + b.length, 0)
      const merged = new Float32Array(total)
      let offset = 0
      for (const buffer of buffers) {
        merged.set(buffer, offset)
        offset += buffer.length
      }
      return { classification, positions: merged, style: ROAD_STYLE[classification] }
    })
  }, [fabric.roads, centre])

  return (
    <group>
      {groups.map(({ classification, positions, style }) => (
        <lineSegments key={classification}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={style.colour} transparent opacity={0.92} toneMapped={false} />
        </lineSegments>
      ))}
    </group>
  )
}

function Buildings({ fabric, centre }: { fabric: UrbanFabric; centre: { lat: number; lon: number } }) {
  // Two instanced meshes: one for buildings with a mapped storey count, one for
  // untagged footprints drawn flat. Keeping them separate is what lets the
  // legend tell the reader which is which.
  const { tagged, untagged } = useMemo(() => {
    const taggedMatrices: THREE.Matrix4[] = []
    const untaggedMatrices: THREE.Matrix4[] = []

    for (const building of fabric.buildings) {
      const { x, z } = projectToMetres(building.centre, centre)
      const matrix = new THREE.Matrix4()
      if (building.levels !== null && building.levels > 0) {
        const heightMetres = building.levels * METRES_PER_LEVEL
        const height = heightMetres * SCALE
        matrix.makeScale(1, Math.max(height / 0.02, 0.2), 1)
        matrix.setPosition(x * SCALE, height / 2, z * SCALE)
        taggedMatrices.push(matrix)
      } else {
        matrix.makeScale(1, 1, 1)
        matrix.setPosition(x * SCALE, 0.008, z * SCALE)
        untaggedMatrices.push(matrix)
      }
    }
    return { tagged: taggedMatrices, untagged: untaggedMatrices }
  }, [fabric.buildings, centre])

  return (
    <group>
      {tagged.length > 0 && (
        <instancedMesh
          args={[undefined, undefined, tagged.length]}
          ref={(mesh) => {
            if (!mesh) return
            tagged.forEach((matrix, i) => mesh.setMatrixAt(i, matrix))
            mesh.instanceMatrix.needsUpdate = true
          }}
        >
          <boxGeometry args={[0.018, 0.02, 0.018]} />
          <meshStandardMaterial color="#8E86C8" roughness={0.55} metalness={0.1} />
        </instancedMesh>
      )}
      {untagged.length > 0 && (
        <instancedMesh
          args={[undefined, undefined, untagged.length]}
          ref={(mesh) => {
            if (!mesh) return
            untagged.forEach((matrix, i) => mesh.setMatrixAt(i, matrix))
            mesh.instanceMatrix.needsUpdate = true
          }}
        >
          <boxGeometry args={[0.016, 0.004, 0.016]} />
          <meshStandardMaterial color="#5C5870" roughness={0.8} />
        </instancedMesh>
      )}
    </group>
  )
}

function GreenSpaces({ fabric, centre }: { fabric: UrbanFabric; centre: { lat: number; lon: number } }) {
  const shapes = useMemo(
    () =>
      fabric.greenSpaces
        .map((space) => {
          const points = space.geometry.map((point) => {
            const { x, z } = projectToMetres(point, centre)
            return new THREE.Vector2(x * SCALE, z * SCALE)
          })
          if (points.length < 3) return null
          return { id: space.id, shape: new THREE.Shape(points), category: space.category }
        })
        .filter((s): s is { id: number; shape: THREE.Shape; category: string } => s !== null),
    [fabric.greenSpaces, centre],
  )

  return (
    <group>
      {shapes.map(({ id, shape, category }) => (
        // Shapes are built in the XZ plane, so rotate the XY-plane geometry flat.
        <mesh key={id} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
          <shapeGeometry args={[shape]} />
          <meshStandardMaterial
            color={category === 'forest' ? '#3D5C45' : '#64816C'}
            roughness={0.95}
            transparent
            opacity={0.85}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  )
}

/**
 * A tinted volume standing in for the observed AQI. It is a visual cue tied to
 * one measured index value, not a modelled pollutant dispersion field.
 */
function Haze({ airQualityIndex }: { airQualityIndex: number }) {
  const opacity = Math.min(airQualityIndex / 500, 1) * 0.3
  const colour =
    airQualityIndex <= 50
      ? '#A7C4AE'
      : airQualityIndex <= 100
        ? '#D9C08A'
        : airQualityIndex <= 150
          ? '#D08A4A'
          : airQualityIndex <= 200
            ? '#C25E3A'
            : '#8B4A6B'

  return (
    <mesh position={[0, 0.35, 0]}>
      <boxGeometry args={[4.6, 0.7, 4.6]} />
      <meshBasicMaterial color={colour} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  )
}

export default function CityScene({ fabric, centre, airQualityIndex = null, cloudCoverPercent = null }: Props) {
  const keyIntensity = 1.5 - (cloudCoverPercent ?? 0) / 100 * 0.75

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[2.4, 3.2, 1.8]} intensity={keyIntensity} color="#FFF4E4" />
      <directionalLight position={[-2, 1.5, -2]} intensity={0.3} color="#8CA8B5" />

      {/* Ground extent of the queried bounding box. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[4.6, 4.6]} />
        <meshStandardMaterial color="#20262B" roughness={1} />
      </mesh>
      <gridHelper args={[4.6, 12, '#2E3740', '#262E35']} position={[0, 0.001, 0]} />

      <GreenSpaces fabric={fabric} centre={centre} />
      <Buildings fabric={fabric} centre={centre} />
      <Roads fabric={fabric} centre={centre} />
      {airQualityIndex !== null && <Haze airQualityIndex={airQualityIndex} />}

      <OrbitControls
        enableZoom
        enablePan
        maxPolarAngle={Math.PI * 0.47}
        minDistance={1.2}
        maxDistance={7}
        target={[0, 0, 0]}
      />
    </>
  )
}
