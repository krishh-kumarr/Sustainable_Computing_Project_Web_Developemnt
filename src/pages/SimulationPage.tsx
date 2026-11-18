import { lazy, Suspense } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { getSource } from '../services/config/dataSources'
import { STATUS_LABEL, simulations } from '../data/simulations'
import LocationBar from '../components/location/LocationBar'
import { useSelectedLocation } from '../context/LocationContext'
import type { ModuleProps } from '../modules/shared'
import EngineWorkbench from '../components/simulation/EngineWorkbench'
import { agricultureEngine } from '../simulation/engines/agriculture'
import { cityEngine } from '../simulation/engines/city'
import { climateEngine } from '../simulation/engines/climate'
import { dataCentreEngine } from '../simulation/engines/datacentre'
import { forestEngine } from '../simulation/engines/forest'
import { waterEngine } from '../simulation/engines/water'
import { WASTE_BASELINE, wasteEngine } from '../simulation/engines/waste'
import {
  useAgricultureBaseline,
  useCityBaseline,
  useClimateBaseline,
  useDataCentreBaseline,
  useForestBaseline,
  useWaterBaseline,
} from '../simulation/state/useBaselines'

const MODULES: Record<string, React.ComponentType<ModuleProps>> = {
  climate: lazy(() => import('../modules/ClimateModule')),
  city: lazy(() => import('../modules/CityModule')),
  waste: lazy(() => import('../modules/WasteModule')),
  datacenter: lazy(() => import('../modules/DataCentreModule')),
  forest: lazy(() => import('../modules/ForestModule')),
  water: lazy(() => import('../modules/WaterModule')),
  agriculture: lazy(() => import('../modules/AgricultureModule')),
}

/** Modules whose data depends on the selected coordinates. */
const LOCATION_AWARE = new Set(['climate', 'city', 'forest', 'water', 'agriculture'])

interface WorkbenchProps {
  accentColor: string
  locationLabel: string
}

// One component per module, so each page fetches only its own data.
const ClimateWorkbench = (p: WorkbenchProps) => <EngineWorkbench engine={climateEngine} baseline={useClimateBaseline()} {...p} />
const CityWorkbench = (p: WorkbenchProps) => <EngineWorkbench engine={cityEngine} baseline={useCityBaseline()} {...p} />
const DataCentreWorkbench = (p: WorkbenchProps) => <EngineWorkbench engine={dataCentreEngine} baseline={useDataCentreBaseline()} {...p} />
const ForestWorkbench = (p: WorkbenchProps) => <EngineWorkbench engine={forestEngine} baseline={useForestBaseline()} {...p} />
const WaterWorkbench = (p: WorkbenchProps) => <EngineWorkbench engine={waterEngine} baseline={useWaterBaseline()} {...p} />
const AgricultureWorkbench = (p: WorkbenchProps) => <EngineWorkbench engine={agricultureEngine} baseline={useAgricultureBaseline()} {...p} />

function ModelWorkbench({ id, accentColor, locationLabel }: { id: string } & WorkbenchProps) {
  const props = { accentColor, locationLabel }
  switch (id) {
    case 'climate': return <ClimateWorkbench {...props} />
    case 'city': return <CityWorkbench {...props} />
    case 'waste': return <EngineWorkbench engine={wasteEngine} baseline={WASTE_BASELINE} {...props} />
    case 'datacenter': return <DataCentreWorkbench {...props} />
    case 'forest': return <ForestWorkbench {...props} />
    case 'water': return <WaterWorkbench {...props} />
    case 'agriculture': return <AgricultureWorkbench {...props} />
    default: return null
  }
}

export default function SimulationPage() {
  const { id } = useParams<{ id: string }>()
  const { label: locationLabel } = useSelectedLocation()
  const sim = simulations.find((entry) => entry.id === id)

  if (!sim) {
    return (
      <main className="min-h-screen bg-ivory flex items-center justify-center px-6">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-graphite mb-2">Simulation not found</h2>
          <p className="text-sm text-graphite/50 mb-4">No module is registered under "{id}".</p>
          <Link to="/explorer" className="text-sm text-sage hover:underline">
            ← Back to Explorer
          </Link>
        </div>
      </main>
    )
  }

  const Module = MODULES[sim.id]

  return (
    <main className="min-h-screen bg-ivory pt-16">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div className="bg-graphite text-ivory px-6 py-10">
        <div className="max-w-7xl mx-auto">
          <Link
            to="/explorer"
            className="inline-flex items-center gap-1.5 text-ivory/50 hover:text-ivory text-sm mb-6 transition-colors"
          >
            <ArrowLeft size={14} /> All Simulations
          </Link>
          <div className="flex items-start justify-between gap-10 flex-wrap">
            <div className="max-w-xl">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <span
                  className="text-xs uppercase tracking-widest font-medium"
                  style={{ color: sim.accentColor }}
                >
                  {sim.subtitle}
                </span>
                <span className="text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-white/10 text-ivory/60">
                  {STATUS_LABEL[sim.status]}
                </span>
              </div>
              <h1 className="text-4xl font-semibold mb-3">{sim.title}</h1>
              <p className="text-ivory/55 text-sm leading-relaxed mb-5">{sim.description}</p>
              <div className="border-l-2 pl-4" style={{ borderColor: `${sim.accentColor}55` }}>
                <div className="text-[10px] uppercase tracking-widest text-ivory/35 font-medium mb-1">
                  What this module does not claim
                </div>
                <p className="text-[12px] text-ivory/55 leading-relaxed">{sim.doesNotClaim}</p>
              </div>
            </div>

            {/* ── Sources, not invented metrics ──────────────────── */}
            <div className="min-w-[260px]">
              <div className="text-[10px] uppercase tracking-widest text-ivory/35 font-medium mb-3">
                Data sources
              </div>
              <ul className="space-y-2">
                {sim.sources
                  .filter((sourceId) => sourceId !== 'none')
                  .map((sourceId) => {
                    const source = getSource(sourceId)
                    return (
                      <li key={sourceId}>
                        <a
                          href={source.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] font-medium text-ivory/85 hover:text-ivory transition-colors"
                        >
                          {source.name}
                        </a>
                        <div className="text-[11px] text-ivory/40 leading-snug">
                          {source.provider}
                          {source.requiresKey && (
                            <span className="text-amber/80"> · requires {source.keyEnvVar}</span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                {sim.sources.every((sourceId) => sourceId === 'none') && (
                  <li className="text-[12px] text-ivory/45 leading-relaxed">
                    No external data source. See the module for what it does instead.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* ── Module body ──────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {LOCATION_AWARE.has(sim.id) && <LocationBar accentColor={sim.color} />}
        {Module ? (
          <Suspense fallback={<div className="rounded-xl bg-white border border-graphite/8 p-8 text-sm text-graphite/45">Loading module…</div>}>
            <Module sim={sim} />
          </Suspense>
        ) : <p className="text-sm text-graphite/50">This module has no implementation registered.</p>}
        <ModelWorkbench id={sim.id} accentColor={sim.color} locationLabel={locationLabel} />
      </div>
    </main>
  )
}
