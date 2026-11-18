/**
 * The React runtime for a simulation engine.
 *
 * It owns the clock, the parameters and the captured scenarios; it owns none of
 * the arithmetic. Everything numeric comes back out of the engine, so the same
 * parameters always give the same trajectory whether the user watched it tick
 * or whether it was run headlessly for a comparison.
 *
 * Time handling is fixed-step: real elapsed time accumulates into a budget and
 * is spent in whole `tickHours` increments. A slow frame therefore produces the
 * same simulated result as a fast one, just later.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  runToCompletion,
  thinSeries,
  type EngineBaseline,
  type MetricValues,
  type ScenarioRun,
  type SeriesRow,
  type SimulationEngine,
} from '../types/engine.ts'
import {
  defaultValues,
  validate,
  type ParameterValues,
  type ValidationIssue,
} from '../types/parameters.ts'
import { compareRuns, type ScenarioComparison } from '../scenarios/compare.ts'

/** Simulated hours advanced per real second, per speed setting. */
export const SPEED_STEPS = [0.5, 1, 2, 4, 8] as const
export type SpeedMultiplier = (typeof SPEED_STEPS)[number]

export interface UseSimulationOptions {
  /** Overrides the engine's default span. */
  durationHours?: number
  /** Simulated hours per real second at speed 1. */
  baseRate?: number
  /** Persist parameters under this key for the session. */
  persistKey?: string
  /** Start paused (the default) or running. */
  autoPlay?: boolean
  /** Honour prefers-reduced-motion by not auto-playing. */
  reducedMotion?: boolean
}

export interface SimulationController<S> {
  // ── Parameters ─────────────────────────────────────────────────────────
  params: ParameterValues
  setParam: (key: string, value: number) => void
  setParams: (values: ParameterValues) => void
  resetParams: () => void
  issues: ValidationIssue[]
  /** Parameters that differ from the engine defaults. */
  isModified: boolean

  // ── Clock ──────────────────────────────────────────────────────────────
  running: boolean
  play: () => void
  pause: () => void
  toggle: () => void
  reset: () => void
  /** Advance exactly one tick while paused. */
  stepOnce: () => void
  speed: SpeedMultiplier
  setSpeed: (speed: SpeedMultiplier) => void
  elapsedHours: number
  durationHours: number
  progress: number
  complete: boolean

  // ── Output ─────────────────────────────────────────────────────────────
  state: S
  metrics: MetricValues
  /** Live series, thinned for charting. */
  series: SeriesRow[]
  explain: string[]

  // ── Scenarios ──────────────────────────────────────────────────────────
  presets: { id: string; label: string; description: string }[]
  applyPreset: (id: string) => void
  activePresetId: string | null
  /** Capture the current parameters as the baseline, run headlessly. */
  captureBaseline: (label?: string) => void
  clearBaseline: () => void
  baselineRun: ScenarioRun | null
  /** A headless run of the current parameters, for comparison. */
  currentRun: ScenarioRun | null
  comparison: ScenarioComparison | null
  /** Restore the parameters the baseline was captured with. */
  restoreBaseline: () => void
  /** CSV of the current run, for the export control. */
  exportCsv: () => string
}

function readPersisted(key: string | undefined): ParameterValues | null {
  if (!key) return null
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as ParameterValues) : null
  } catch {
    return null
  }
}

export function useSimulation<S, B extends EngineBaseline>(
  engine: SimulationEngine<S, B>,
  baseline: B,
  options: UseSimulationOptions = {},
): SimulationController<S> {
  const {
    durationHours = engine.defaultDurationHours,
    baseRate = engine.tickHours * 12,
    persistKey,
    autoPlay = false,
    reducedMotion = false,
  } = options

  const specs = engine.parameters
  const engineDefaults = useMemo(() => defaultValues(specs), [specs])

  const [params, setParamsState] = useState<ParameterValues>(() => {
    const persisted = readPersisted(persistKey)
    return persisted ? validate(specs, { ...engineDefaults, ...persisted }).values : engineDefaults
  })
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [activePresetId, setActivePresetId] = useState<string | null>(null)

  const [running, setRunning] = useState(autoPlay && !reducedMotion)
  const [speed, setSpeed] = useState<SpeedMultiplier>(1)

  // The live state is kept in a ref and mirrored into React state on each tick.
  // Mutating a ref inside the animation loop keeps the loop free of stale
  // closures; the mirror is what triggers a render.
  const stateRef = useRef<S>(engine.init(params, baseline))
  const seriesRef = useRef<SeriesRow[]>([engine.sample(stateRef.current, params, baseline)])
  const elapsedRef = useRef(0)
  const [version, setVersion] = useState(0)

  const [baselineRun, setBaselineRun] = useState<ScenarioRun | null>(null)

  // Re-initialise whenever the engine, its parameters, or the real-data
  // baseline change. A new baseline means the starting point moved, and
  // continuing the old trajectory from it would be meaningless.
  const resetRun = useCallback(() => {
    stateRef.current = engine.init(params, baseline)
    seriesRef.current = [engine.sample(stateRef.current, params, baseline)]
    elapsedRef.current = 0
    setVersion((n) => n + 1)
  }, [engine, params, baseline])

  useEffect(() => {
    resetRun()
  }, [resetRun])

  useEffect(() => {
    if (!persistKey) return
    try {
      sessionStorage.setItem(persistKey, JSON.stringify(params))
    } catch {
      // A browser refusing session storage is not worth surfacing.
    }
  }, [persistKey, params])

  // ── The clock ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!running) return

    let frame = 0
    let previous = performance.now()
    let budget = 0

    const loop = (now: number) => {
      // Clamp the frame delta so a backgrounded tab does not fast-forward the
      // whole run on return.
      const deltaSeconds = Math.min((now - previous) / 1000, 0.25)
      previous = now
      budget += deltaSeconds * baseRate * speed

      let ticked = false
      // Cap ticks per frame so a very high speed degrades frame rate rather
      // than locking the main thread.
      let guard = 0
      while (budget >= engine.tickHours && guard < 240) {
        if (elapsedRef.current >= durationHours || engine.isComplete?.(stateRef.current, params)) {
          budget = 0
          setRunning(false)
          break
        }
        stateRef.current = engine.step(stateRef.current, params, baseline, engine.tickHours)
        seriesRef.current = [...seriesRef.current, engine.sample(stateRef.current, params, baseline)]
        elapsedRef.current = engine.elapsedHours(stateRef.current)
        budget -= engine.tickHours
        ticked = true
        guard++
      }

      if (ticked) setVersion((n) => n + 1)
      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [running, speed, baseRate, engine, params, baseline, durationHours])

  // ── Parameter mutation ─────────────────────────────────────────────────
  const setParam = useCallback(
    (key: string, value: number) => {
      setParamsState((previous) => {
        const next = validate(specs, { ...previous, [key]: value })
        setIssues(next.issues)
        return next.values
      })
      setActivePresetId(null)
    },
    [specs],
  )

  const setParams = useCallback(
    (values: ParameterValues) => {
      const next = validate(specs, { ...engineDefaults, ...values })
      setIssues(next.issues)
      setParamsState(next.values)
    },
    [specs, engineDefaults],
  )

  const resetParams = useCallback(() => {
    setParamsState(engineDefaults)
    setIssues([])
    setActivePresetId(null)
  }, [engineDefaults])

  const applyPreset = useCallback(
    (id: string) => {
      const preset = engine.presets.find((entry) => entry.id === id)
      if (!preset) return
      const next = validate(specs, { ...engineDefaults, ...preset.overrides })
      setIssues(next.issues)
      setParamsState(next.values)
      setActivePresetId(id)
    },
    [engine.presets, specs, engineDefaults],
  )

  // ── Derived output ─────────────────────────────────────────────────────
  // `version` is the dependency that makes these recompute after each tick;
  // the state itself lives in a ref and so is invisible to React.
  const metrics = useMemo(
    () => engine.derive(stateRef.current, params, baseline),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, params, baseline, version],
  )
  const explain = useMemo(
    () => engine.explain(stateRef.current, params, baseline),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, params, baseline, version],
  )
  const series = useMemo(
    () => thinSeries(seriesRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  )

  // ── Scenario comparison ────────────────────────────────────────────────
  // The current run is computed headlessly over the full span rather than read
  // off the live clock, so a comparison never depends on how long the user
  // happened to let the animation play.
  const currentRun = useMemo<ScenarioRun | null>(() => {
    if (!baselineRun) return null
    return runToCompletion(engine, params, baseline, {
      durationHours,
      label: 'Alternative',
      kind: 'alternative',
      id: 'alternative',
    })
  }, [engine, params, baseline, durationHours, baselineRun])

  const comparison = useMemo<ScenarioComparison | null>(() => {
    if (!baselineRun || !currentRun) return null
    return compareRuns(engine.metrics, specs, baselineRun, currentRun)
  }, [engine.metrics, specs, baselineRun, currentRun])

  const captureBaseline = useCallback(
    (label = 'Baseline') => {
      setBaselineRun(
        runToCompletion(engine, params, baseline, {
          durationHours,
          label,
          kind: 'baseline',
          id: 'baseline',
        }),
      )
    },
    [engine, params, baseline, durationHours],
  )

  const restoreBaseline = useCallback(() => {
    if (!baselineRun) return
    setParams(baselineRun.params)
    setActivePresetId(null)
  }, [baselineRun, setParams])

  const exportCsv = useCallback(() => {
    const rows = seriesRef.current
    if (rows.length === 0) return ''
    const keys = ['t', ...engine.series.map((entry) => entry.key)]
    const header = [
      `# ${engine.label} — simulated output`,
      `# Generated ${new Date().toISOString()}`,
      `# Parameters: ${Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')}`,
      '# Values are model output unless a column says otherwise. See the module for assumptions.',
      keys
        .map((key) => {
          if (key === 't') return `t (${engine.timeUnit})`
          const definition = engine.series.find((entry) => entry.key === key)
          return definition ? `${definition.label} (${definition.unit})` : key
        })
        .join(','),
    ].join('\n')
    const body = rows
      .map((row) => keys.map((key) => (row[key] === null || row[key] === undefined ? '' : row[key])).join(','))
      .join('\n')
    return `${header}\n${body}\n`
  }, [engine, params])

  const elapsedHours = elapsedRef.current
  const complete =
    elapsedHours >= durationHours || Boolean(engine.isComplete?.(stateRef.current, params))

  return {
    params,
    setParam,
    setParams,
    resetParams,
    issues,
    isModified: Object.keys(engineDefaults).some((key) => params[key] !== engineDefaults[key]),

    running,
    play: useCallback(() => setRunning(true), []),
    pause: useCallback(() => setRunning(false), []),
    toggle: useCallback(() => setRunning((value) => !value), []),
    reset: useCallback(() => {
      setRunning(false)
      resetRun()
    }, [resetRun]),
    stepOnce: useCallback(() => {
      stateRef.current = engine.step(stateRef.current, params, baseline, engine.tickHours)
      seriesRef.current = [...seriesRef.current, engine.sample(stateRef.current, params, baseline)]
      elapsedRef.current = engine.elapsedHours(stateRef.current)
      setVersion((n) => n + 1)
    }, [engine, params, baseline]),
    speed,
    setSpeed,
    elapsedHours,
    durationHours,
    progress: durationHours > 0 ? Math.min(elapsedHours / durationHours, 1) : 0,
    complete,

    state: stateRef.current,
    metrics,
    series,
    explain,

    presets: engine.presets.map(({ id, label, description }) => ({ id, label, description })),
    applyPreset,
    activePresetId,
    captureBaseline,
    clearBaseline: useCallback(() => setBaselineRun(null), []),
    baselineRun,
    currentRun,
    comparison,
    restoreBaseline,
    exportCsv,
  }
}

/** Respects the OS reduced-motion setting. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}
