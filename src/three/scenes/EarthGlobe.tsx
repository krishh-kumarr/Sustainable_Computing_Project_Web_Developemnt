import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls, Stars, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { latLonToVector3, temperatureColour } from '../geo'

/**
 * A recognisable, textured Earth.
 *
 * Textures are NASA Blue Marble derivatives shipped with the three.js
 * examples, served locally from /textures.
 *
 * Data connection: the selected location gets a marker at its true
 * latitude/longitude, tinted by the observed 2 m temperature, and the cloud
 * layer's opacity follows the observed cloud cover at that location. The cloud
 * texture itself is a static global image — it is a visual cue for the single
 * reported cloud-cover percentage, not a satellite cloud field. That is stated
 * in the scene's caption.
 */

export interface GlobeMarker {
  latitude: number
  longitude: number
  label: string
  /** Observed temperature at the marker, °C. Null leaves the marker neutral. */
  temperatureCelsius: number | null
}

interface Props {
  marker?: GlobeMarker | null
  /** Observed total cloud cover at the marker, 0–100 %. */
  cloudCoverPercent?: number | null
  /** Is it daytime at the marker? Shifts the key light. */
  isDay?: boolean | null
  /** Range the marker's temperature colour is mapped across. */
  temperatureRange?: [number, number]
  autoRotate?: boolean
  interactive?: boolean
  radius?: number
}

function Marker({ marker, radius, range }: { marker: GlobeMarker; radius: number; range: [number, number] }) {
  const position = useMemo(
    () => latLonToVector3(marker.latitude, marker.longitude, radius * 1.015),
    [marker.latitude, marker.longitude, radius],
  )
  const outer = useMemo(
    () => latLonToVector3(marker.latitude, marker.longitude, radius * 1.09),
    [marker.latitude, marker.longitude, radius],
  )

  const colour = useMemo(
    () =>
      marker.temperatureCelsius === null
        ? new THREE.Color('#F5F4EF')
        : temperatureColour(marker.temperatureCelsius, range[0], range[1]),
    [marker.temperatureCelsius, range],
  )

  const pulseRef = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!pulseRef.current) return
    const t = (clock.getElapsedTime() % 2.4) / 2.4
    const scale = 1 + t * 2.4
    pulseRef.current.scale.setScalar(scale)
    const material = pulseRef.current.material as THREE.MeshBasicMaterial
    material.opacity = 0.5 * (1 - t)
  })

  // Billboarded line from the surface outward, so the marker reads at any angle.
  const linePoints = useMemo(() => [position, outer], [position, outer])

  return (
    <group>
      <mesh position={position}>
        <sphereGeometry args={[radius * 0.022, 16, 16]} />
        <meshBasicMaterial color={colour} toneMapped={false} />
      </mesh>
      <mesh ref={pulseRef} position={position}>
        <sphereGeometry args={[radius * 0.022, 16, 16]} />
        <meshBasicMaterial color={colour} transparent opacity={0.5} toneMapped={false} depthWrite={false} />
      </mesh>
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array(linePoints.flatMap((p) => [p.x, p.y, p.z])), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={colour} transparent opacity={0.7} toneMapped={false} />
      </line>
      <mesh position={outer}>
        <sphereGeometry args={[radius * 0.012, 12, 12]} />
        <meshBasicMaterial color={colour} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Globe({ marker, cloudCoverPercent, isDay, temperatureRange, autoRotate, radius }: Required<
  Pick<Props, 'radius' | 'autoRotate'>
> &
  Pick<Props, 'marker' | 'cloudCoverPercent' | 'isDay' | 'temperatureRange'>) {
  // Colour textures must be tagged sRGB or the continents render washed out.
  // Done in useTexture's callback rather than by mutating the returned objects
  // during render, because drei caches textures globally and a render-phase
  // mutation would reach every other consumer of the same file.
  const [surface, clouds, specular] = useTexture(
    [
      '/textures/earth_atmos_2048.jpg',
      '/textures/earth_clouds_1024.png',
      '/textures/earth_specular_2048.jpg',
    ],
    (loaded) => {
      const [surfaceMap, cloudMap] = Array.isArray(loaded) ? loaded : [loaded]
      surfaceMap.colorSpace = THREE.SRGBColorSpace
      cloudMap.colorSpace = THREE.SRGBColorSpace
    },
  )

  const earthRef = useRef<THREE.Group>(null)
  const cloudRef = useRef<THREE.Mesh>(null)

  // Rotate the whole globe group so the marker stays locked to its coordinates.
  useFrame((_, delta) => {
    if (!autoRotate) return
    if (earthRef.current) earthRef.current.rotation.y += delta * 0.035
    // Clouds drift slightly faster than the surface, as they do in reality.
    if (cloudRef.current) cloudRef.current.rotation.y += delta * 0.012
  })

  // Opacity tracks the single reported cloud-cover figure for the marker.
  const cloudOpacity =
    cloudCoverPercent === null || cloudCoverPercent === undefined
      ? 0.3
      : 0.06 + (Math.min(Math.max(cloudCoverPercent, 0), 100) / 100) * 0.62

  const keyIntensity = isDay === false ? 1.15 : 1.9

  return (
    <group>
      <ambientLight intensity={isDay === false ? 0.4 : 0.5} />
      <directionalLight position={[5, 2.5, 4]} intensity={keyIntensity} color="#FFF6E8" />
      <directionalLight position={[-5, -1.5, -4]} intensity={0.28} color="#8CA8B5" />
      <Stars radius={90} depth={60} count={2600} factor={3.2} fade speed={0.3} />

      <group ref={earthRef}>
        <mesh>
          <sphereGeometry args={[radius, 96, 96]} />
          <meshPhongMaterial
            map={surface}
            specularMap={specular}
            specular={new THREE.Color('#3A4A52')}
            shininess={12}
          />
        </mesh>

        <mesh ref={cloudRef}>
          <sphereGeometry args={[radius * 1.012, 64, 64]} />
          <meshPhongMaterial
            map={clouds}
            transparent
            opacity={cloudOpacity}
            depthWrite={false}
            alphaMap={clouds}
          />
        </mesh>

        {marker && <Marker marker={marker} radius={radius} range={temperatureRange ?? [-10, 45]} />}
      </group>

      {/* Atmospheric rim, drawn from inside a slightly larger shell. */}
      <mesh>
        <sphereGeometry args={[radius * 1.055, 64, 64]} />
        <meshBasicMaterial color="#8CA8B5" transparent opacity={0.14} side={THREE.BackSide} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[radius * 1.12, 48, 48]} />
        <meshBasicMaterial color="#6E8FA0" transparent opacity={0.055} side={THREE.BackSide} depthWrite={false} />
      </mesh>
    </group>
  )
}

export default function EarthGlobe({
  marker = null,
  cloudCoverPercent = null,
  isDay = null,
  temperatureRange = [-10, 45],
  autoRotate = true,
  interactive = true,
  radius = 1,
}: Props) {
  return (
    <>
      <Globe
        marker={marker}
        cloudCoverPercent={cloudCoverPercent}
        isDay={isDay}
        temperatureRange={temperatureRange}
        autoRotate={autoRotate}
        radius={radius}
      />
      {interactive && (
        <OrbitControls
          enableZoom
          enablePan={false}
          minDistance={radius * 1.4}
          maxDistance={radius * 5}
          rotateSpeed={0.5}
          zoomSpeed={0.6}
        />
      )}
    </>
  )
}
