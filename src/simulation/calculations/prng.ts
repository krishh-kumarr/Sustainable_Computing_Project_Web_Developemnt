/**
 * Deterministic pseudo-random number generation.
 *
 * Simulations in this platform must be reproducible: the same parameters must
 * produce the same result, every run, or scenario comparison means nothing.
 * `Math.random()` is therefore banned inside engines. Where a model needs
 * variation — waste item arrival, ember flicker, crop placement — it draws from
 * one of these, seeded from the scenario, and the seed travels in the state.
 *
 * mulberry32: a small, fast, well-distributed 32-bit generator.
 */

export interface Prng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number
  /** Uniform float in [min, max). */
  range(min: number, max: number): number
  /** Picks one item, weighted by the supplied weights. */
  weighted<T>(items: T[], weights: number[]): T
  /** Current internal state, so it can be stored and resumed. */
  readonly state: number
}

export function createPrng(seed: number): Prng {
  let s = seed >>> 0
  const api: Prng = {
    next() {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
    int(min, max) {
      return min + Math.floor(api.next() * (max - min + 1))
    },
    range(min, max) {
      return min + api.next() * (max - min)
    },
    weighted(items, weights) {
      const total = weights.reduce((sum, weight) => sum + Math.max(weight, 0), 0)
      if (total <= 0) return items[0]
      let roll = api.next() * total
      for (let i = 0; i < items.length; i++) {
        roll -= Math.max(weights[i], 0)
        if (roll <= 0) return items[i]
      }
      return items[items.length - 1]
    },
    get state() {
      return s
    },
  }
  return api
}

/** Stable 32-bit hash of a string, for deriving a seed from a scenario id. */
export function hashSeed(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
