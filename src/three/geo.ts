import * as THREE from 'three'

/**
 * Latitude/longitude to a point on a sphere, matching the UV layout three.js
 * gives SphereGeometry for an equirectangular texture (u = 0 at lon −180°).
 */
export function latLonToVector3(latitude: number, longitude: number, radius: number): THREE.Vector3 {
  const phi = ((90 - latitude) * Math.PI) / 180
  const theta = ((longitude + 180) * Math.PI) / 180
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

/** Normalise a value into 0–1 against an explicit range. Clamped. */
export function normalise(value: number, min: number, max: number): number {
  if (max === min) return 0
  return Math.min(Math.max((value - min) / (max - min), 0), 1)
}

/**
 * A perceptually simple cool→warm ramp for temperature, inside the platform's
 * palette. The range is always stated beside the visual, because a colour with
 * an unstated range communicates nothing.
 */
export function temperatureColour(celsius: number, min = -10, max = 45): THREE.Color {
  const t = normalise(celsius, min, max)
  const cool = new THREE.Color('#8CA8B5')
  const mid = new THREE.Color('#E8DCC0')
  const warm = new THREE.Color('#C25E3A')
  return t < 0.5
    ? cool.clone().lerp(mid, t * 2)
    : mid.clone().lerp(warm, (t - 0.5) * 2)
}
