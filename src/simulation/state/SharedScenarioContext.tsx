/**
 * Cross-module scenario levers.
 *
 * Four assumptions genuinely belong to more than one model, and holding them in
 * one place is what makes the connections between modules real rather than
 * decorative: raise the temperature anomaly in Climate and the fire model's
 * fuel drying, the reservoir's evaporation and the crop's water demand all move
 * with it, through their own documented formulas.
 *
 * The discipline is that a lever only connects where a defensible physical or
 * accounting relationship exists. There is deliberately no lever that makes,
 * say, waste recovery depend on grid carbon intensity, because no such
 * relationship holds.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { SharedLeverKey } from '../types/parameters.ts'

export interface SharedLeverSpec {
  key: SharedLeverKey
  label: string
  unit: string
  min: number
  max: number
  step: number
  default: number
  description: string
  /** Which modules consume this lever, and through which mechanism. */
  consumers: { module: string; mechanism: string }[]
}

export const SHARED_LEVERS: SharedLeverSpec[] = [
  {
    key: 'temperatureAnomalyK',
    label: 'Temperature anomaly',
    unit: 'K',
    min: -2,
    max: 6,
    step: 0.1,
    default: 0,
    description:
      'A uniform offset applied to the observed temperature baseline. Real warming is not uniform across seasons, latitudes or day and night.',
    consumers: [
      {
        module: 'Climate Intelligence',
        mechanism: 'Offsets the ERA5 temperature baseline and seeds the energy-balance model.',
      },
      {
        module: 'Forest Intelligence',
        mechanism:
          'Raises the fine-fuel moisture-loss term in the spread model, through the documented temperature damping coefficient.',
      },
      {
        module: 'AquaGuard',
        mechanism:
          'Scales reservoir evaporation via a temperature-dependent rate, raising losses from the water balance.',
      },
      {
        module: 'AgriFuture',
        mechanism:
          'Raises reference evapotranspiration by the stated sensitivity, increasing crop water demand.',
      },
    ],
  },
  {
    key: 'precipitationScalePercent',
    label: 'Precipitation scaling',
    unit: '%',
    min: 30,
    max: 200,
    step: 5,
    default: 100,
    description:
      'A uniform multiplier on observed and forecast rainfall. Real precipitation change alters intensity distribution, not just totals.',
    consumers: [
      { module: 'Climate Intelligence', mechanism: 'Scales the ERA5 precipitation record.' },
      {
        module: 'AquaGuard',
        mechanism: 'Scales catchment rainfall, which feeds the reservoir inflow term directly.',
      },
      {
        module: 'AgriFuture',
        mechanism: 'Scales rainfall in the FAO-56 water balance, reducing the irrigation requirement.',
      },
      {
        module: 'Forest Intelligence',
        mechanism: 'Raises fuel moisture, which damps the rate of spread.',
      },
    ],
  },
  {
    key: 'gridCarbonIntensity',
    label: 'Grid carbon intensity',
    unit: 'gCO₂e/kWh',
    min: 10,
    max: 900,
    step: 5,
    default: 450,
    description:
      'Carbon intensity of the non-renewable share of electricity supply. Regional and highly variable; look up your own grid operator.',
    consumers: [
      {
        module: 'Green Data Centre',
        mechanism: 'Converts facility electricity consumption into operational emissions.',
      },
      {
        module: 'Smart City',
        mechanism: 'Converts urban electricity demand into emissions on the same accounting basis.',
      },
    ],
  },
  {
    key: 'renewableSharePercent',
    label: 'Renewable supply share',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    default: 30,
    description:
      'Share of electricity treated as zero-carbon at the point of use. Excludes embodied generation emissions and the gap between contractual and physical supply.',
    consumers: [
      { module: 'Green Data Centre', mechanism: 'Reduces the emitting fraction of facility energy.' },
      { module: 'Smart City', mechanism: 'Reduces the emitting fraction of urban electricity demand.' },
    ],
  },
]

export type SharedLeverValues = Record<SharedLeverKey, number>

export const SHARED_DEFAULTS: SharedLeverValues = SHARED_LEVERS.reduce((acc, lever) => {
  acc[lever.key] = lever.default
  return acc
}, {} as SharedLeverValues)

export interface SharedScenarioValue {
  levers: SharedLeverValues
  setLever: (key: SharedLeverKey, value: number) => void
  reset: () => void
  /** Levers currently differing from their defaults. */
  modifiedKeys: SharedLeverKey[]
  /** True when a module has taken local control of a lever. */
  isOverridden: (key: SharedLeverKey) => boolean
  setOverride: (key: SharedLeverKey, overridden: boolean) => void
}

const SharedScenarioContext = createContext<SharedScenarioValue | null>(null)

const STORAGE_KEY = 'terraverse.sharedScenario.v1'

function readStored(): SharedLeverValues {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return SHARED_DEFAULTS
    const parsed = JSON.parse(raw) as Partial<SharedLeverValues>
    const merged = { ...SHARED_DEFAULTS }
    for (const lever of SHARED_LEVERS) {
      const value = parsed[lever.key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        merged[lever.key] = Math.min(Math.max(value, lever.min), lever.max)
      }
    }
    return merged
  } catch {
    return SHARED_DEFAULTS
  }
}

export function SharedScenarioProvider({ children }: { children: ReactNode }) {
  const [levers, setLevers] = useState<SharedLeverValues>(readStored)
  const [overrides, setOverrides] = useState<Partial<Record<SharedLeverKey, boolean>>>({})

  const setLever = useCallback((key: SharedLeverKey, value: number) => {
    setLevers((previous) => {
      const spec = SHARED_LEVERS.find((lever) => lever.key === key)
      const clamped = spec ? Math.min(Math.max(value, spec.min), spec.max) : value
      const next = { ...previous, [key]: clamped }
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Session storage being unavailable is not worth surfacing.
      }
      return next
    })
  }, [])

  const reset = useCallback(() => {
    setLevers(SHARED_DEFAULTS)
    setOverrides({})
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo<SharedScenarioValue>(
    () => ({
      levers,
      setLever,
      reset,
      modifiedKeys: SHARED_LEVERS.filter((lever) => levers[lever.key] !== lever.default).map(
        (lever) => lever.key,
      ),
      isOverridden: (key) => Boolean(overrides[key]),
      setOverride: (key, overridden) =>
        setOverrides((previous) => ({ ...previous, [key]: overridden })),
    }),
    [levers, setLever, reset, overrides],
  )

  return <SharedScenarioContext.Provider value={value}>{children}</SharedScenarioContext.Provider>
}

export function useSharedScenario(): SharedScenarioValue {
  const context = useContext(SharedScenarioContext)
  if (!context) throw new Error('useSharedScenario must be used inside a SharedScenarioProvider.')
  return context
}

/**
 * Merges the shared levers into a parameter set, for any parameter whose spec
 * declares a `sharedKey` and which the module has not locally overridden.
 */
export function applySharedLevers(
  specs: { key: string; sharedKey?: SharedLeverKey }[],
  params: Record<string, number>,
  levers: SharedLeverValues,
  isOverridden: (key: SharedLeverKey) => boolean,
): Record<string, number> {
  let changed = false
  const next = { ...params }
  for (const spec of specs) {
    if (!spec.sharedKey || isOverridden(spec.sharedKey)) continue
    const value = levers[spec.sharedKey]
    if (next[spec.key] !== value) {
      next[spec.key] = value
      changed = true
    }
  }
  return changed ? next : params
}
