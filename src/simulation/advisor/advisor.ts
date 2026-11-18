/**
 * Sustainability Advisor entry point.
 *
 * Runs the rule set for an engine and returns a ranked report. The advisor
 * owns no numbers of its own: every quantified claim comes from re-running the
 * simulation engine, and every finding carries the rule that produced it.
 */

import { runToCompletion, type EngineBaseline, type SimulationEngine } from '../types/engine.ts'
import { validate, type ParameterValues } from '../types/parameters.ts'
import { RULES_BY_ENGINE } from './rules.ts'
import { ADVISOR_METHOD, type AdvisorContext, type AdvisorFinding, type AdvisorReport } from './types.ts'

export function buildReport<S, B extends EngineBaseline>(
  engine: SimulationEngine<S, B>,
  params: ParameterValues,
  baseline: B,
  options: { locationLabel?: string; durationHours?: number; baselineRun?: AdvisorContext['baselineRun'] } = {},
): AdvisorReport {
  const durationHours = options.durationHours ?? engine.defaultDurationHours

  const currentRun = runToCompletion(engine, params, baseline, {
    durationHours,
    label: 'Current',
    kind: 'alternative',
    id: 'advisor-current',
  })

  // Memoised so several rules probing the same change cost one run.
  const cache = new Map<string, ReturnType<typeof runToCompletion>>()
  const evaluate = (overrides: ParameterValues) => {
    const merged = validate(engine.parameters, { ...params, ...overrides }).values
    const key = JSON.stringify(merged)
    let run = cache.get(key)
    if (!run) {
      run = runToCompletion(engine, merged, baseline, { durationHours, id: `advisor-${key.length}` })
      cache.set(key, run)
    }
    return run.metrics
  }

  const context: AdvisorContext = {
    engineId: engine.id,
    engineLabel: engine.label,
    params,
    metrics: currentRun.metrics,
    currentRun,
    baselineRun: options.baselineRun ?? null,
    locationLabel: options.locationLabel ?? 'the selected location',
    seededFromObservation: baseline.seededFromObservation,
    provenance: baseline.provenance,
    evaluate,
  }

  const rules = RULES_BY_ENGINE[engine.id] ?? []
  const findings: AdvisorFinding[] = []

  for (const rule of rules) {
    try {
      const finding = rule(context)
      if (finding) findings.push(finding)
    } catch (error) {
      // A rule that throws must not take the whole report down. It is omitted
      // silently rather than reported as a finding, because a broken rule has
      // nothing useful to say.
      if (import.meta.env?.DEV) console.warn(`[advisor] rule failed for ${engine.id}`, error)
    }
  }

  // Cautions and trade-offs first within each weight band: a reader needs to
  // know what is going wrong before what could go better.
  const kindRank: Record<AdvisorFinding['kind'], number> = {
    caution: 4,
    'trade-off': 3,
    opportunity: 2,
    observation: 1,
    limitation: 0,
  }

  findings.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight
    return kindRank[b.kind] - kindRank[a.kind]
  })

  return {
    engineId: engine.id,
    findings,
    method: ADVISOR_METHOD,
    generatedAt: new Date().toISOString(),
  }
}

export { ADVISOR_METHOD }
export type { AdvisorFinding, AdvisorReport } from './types.ts'
