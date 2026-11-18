import { useEffect, useMemo } from 'react'
import AssumptionsPanel from './AssumptionsPanel'
import AdvisorPanel from './AdvisorPanel'
import MetricGrid from './MetricGrid'
import ParameterPanel from './ParameterPanel'
import ScenarioComparison from './ScenarioComparison'
import SimulationChart from './SimulationChart'
import SimulationConsole from './SimulationConsole'
import SharedScenarioPanel from './SharedScenarioPanel'
import { applySharedLevers, useSharedScenario } from '../../simulation/state/SharedScenarioContext'
import { useSimulation } from '../../simulation/state/useSimulation'
import type { EngineBaseline, SimulationEngine } from '../../simulation/types/engine'
import type { SharedLeverKey } from '../../simulation/types/parameters'

interface Props<S, B extends EngineBaseline> {
  engine: SimulationEngine<S, B>
  baseline: B
  accentColor: string
  locationLabel: string
}

/**
 * The common interaction loop for every model. The domain modules retain their
 * real-data panels and 3D scenes; this workbench supplies the shared,
 * deterministic model controls and makes their calculations auditable.
 */
export default function EngineWorkbench<S, B extends EngineBaseline>({
  engine,
  baseline,
  accentColor,
  locationLabel,
}: Props<S, B>) {
  const { levers, isOverridden } = useSharedScenario()
  const controller = useSimulation(engine, baseline, {
    persistKey: `terraverse.simulation.${engine.id}`,
    reducedMotion: typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  })
  const { params, setParams } = controller

  const sharedKeys = useMemo(
    () =>
      new Set(
        engine.parameters
          .filter((parameter) => parameter.sharedKey && !isOverridden(parameter.sharedKey))
          .map((parameter) => parameter.key),
      ),
    [engine.parameters, isOverridden],
  )

  useEffect(() => {
    const merged = applySharedLevers(engine.parameters, params, levers, isOverridden)
    if (merged !== params) setParams(merged)
  }, [engine.parameters, isOverridden, levers, params, setParams])

  return (
    <section className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-1">
            Interactive model
          </div>
          <h2 className="text-xl font-semibold text-graphite">{engine.label}</h2>
          <p className="text-[12px] text-graphite/50 mt-1 max-w-2xl">
            Deterministic illustrative scenario for {locationLabel}. Outputs are model estimates unless
            explicitly marked as observed.
          </p>
        </div>
        {controller.issues.length > 0 && (
          <div className="text-[11px] text-amber bg-amber/10 border border-amber/20 rounded-lg px-3 py-2">
            Some saved parameters were corrected to valid ranges.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <MetricGrid definitions={engine.metrics} values={controller.metrics} accentColor={accentColor} headlineOnly />
          <SimulationConsole
            controller={controller}
            accentColor={accentColor}
            timeUnit={engine.timeUnit}
            exportName={engine.id}
          />
          <div className="bg-white border border-graphite/10 rounded-xl p-5">
            <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-3">
              Live model output
            </div>
            <SimulationChart
              series={controller.series}
              keys={engine.series}
              timeUnit={engine.timeUnit}
              accentColor={accentColor}
            />
          </div>
          <MetricGrid
            definitions={engine.metrics}
            values={controller.metrics}
            accentColor={accentColor}
            excludeHeadline
            columns={3}
          />
          <ScenarioComparison
            controller={controller}
            seriesKeys={engine.series}
            timeUnit={engine.timeUnit}
            accentColor={accentColor}
          />
          <AssumptionsPanel
            disclaimer={engine.disclaimer}
            assumptions={engine.assumptions}
            explain={controller.explain}
            provenance={baseline.provenance}
          />
        </div>
        <div className="space-y-6 lg:sticky lg:top-24">
          <ParameterPanel
            specs={engine.parameters}
            values={params}
            onChange={controller.setParam}
            onReset={controller.resetParams}
            accentColor={accentColor}
            sharedKeys={sharedKeys}
          />
          <SharedScenarioPanel
            accentColor={accentColor}
            relevantKeys={engine.parameters
              .map((parameter) => parameter.sharedKey)
              .filter((key): key is SharedLeverKey => Boolean(key))}
          />
          <AdvisorPanel
            engine={engine}
            params={params}
            baseline={baseline}
            locationLabel={locationLabel}
            durationHours={controller.durationHours}
            accentColor={accentColor}
            onApply={controller.setParams}
          />
        </div>
      </div>
    </section>
  )
}
