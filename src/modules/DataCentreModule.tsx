import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, Calculator, Cpu, ExternalLink, Pause, Play, RotateCcw, ShieldAlert } from 'lucide-react'
import { AXIS_TICK, CHART_GRID_STROKE, TOOLTIP_STYLE, unitFormatter } from '../components/data/chartFormat'
import DataSourceBadge from '../components/data/DataSourceBadge'
import DataSourceStatus from '../components/data/DataSourceStatus'
import LastUpdated from '../components/data/LastUpdated'
import MetricCard from '../components/data/MetricCard'
import Panel from '../components/data/Panel'
import SourcePanel from '../components/data/SourcePanel'
import SceneFrame from '../three/SceneFrame'
import DataCentreScene from '../three/scenes/DataCentreScene'
import {
  DEFAULT_ENERGY_INPUTS,
  INPUT_METADATA,
  MODEL_ASSUMPTIONS,
  computeEnergy,
  explainCalculation,
  type EnergyInputs,
} from '../services/domain/energyModel'
import {
  TELEMETRY_LIMITATIONS,
  detectCapabilities,
  formatBytes,
  sampleTelemetry,
  type TelemetrySample,
} from '../services/domain/browserTelemetry'
import { round } from '../services/data/normalizers/units'
import { ControlSlider, LegendRow, ModuleLayout, SceneLegend, type ModuleProps } from './shared'

export default function DataCentreModule({ sim }: ModuleProps) {
  const [inputs, setInputs] = useState<EnergyInputs>(DEFAULT_ENERGY_INPUTS)
  const result = useMemo(() => computeEnergy(inputs), [inputs])
  const steps = useMemo(() => explainCalculation(inputs, result), [inputs, result])

  // ── Browser telemetry sampling ──────────────────────────────────────────
  const capabilities = useMemo(() => detectCapabilities(), [])
  const [sample, setSample] = useState<TelemetrySample | null>(null)
  const [sampling, setSampling] = useState(true)
  const [history, setHistory] = useState<{ at: string; load: number | null; fps: number | null }[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const takeSample = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const next = await sampleTelemetry(1200, controller.signal)
    if (controller.signal.aborted) return
    setSample(next)
    setHistory((previous) =>
      [...previous, { at: next.at.slice(11, 19), load: next.mainThreadLoad, fps: next.framesPerSecond }].slice(-24),
    )
  }, [])

  useEffect(() => {
    if (!sampling) {
      abortRef.current?.abort()
      return
    }
    let active = true
    const loop = async () => {
      while (active && sampling) {
        await takeSample()
        if (!active) return
        await new Promise((resolve) => setTimeout(resolve, 1800))
      }
    }
    void loop()
    return () => {
      active = false
      abortRef.current?.abort()
    }
  }, [sampling, takeSample])

  const energyBreakdown = useMemo(
    () => [
      { label: 'IT equipment', kw: round(result.itPowerKw, 1), tone: sim.color },
      { label: 'Cooling & overhead', kw: round(result.overheadPowerKw, 1), tone: '#8CA8B5' },
    ],
    [result, sim.color],
  )

  return (
    <ModuleLayout
      main={
        <>
          {/* ── Honest framing, before any number ─────────────────── */}
          <div className="bg-white border border-graphite/12 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg bg-graphite/4 flex items-center justify-center shrink-0 mt-0.5">
                <ShieldAlert size={15} className="text-graphite/45" />
              </span>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-1">
                  What this module is
                </div>
                <h3 className="text-[15px] font-semibold text-graphite mb-2">
                  A calculator, not a monitoring dashboard
                </h3>
                <p className="text-[12px] text-graphite/60 leading-relaxed">
                  No free public API reports live power consumption for an arbitrary data centre, so this module
                  does not pretend to read one. Everything below the telemetry panel is arithmetic on inputs you
                  set, with the full formula chain on screen so you can check it by hand. The only measured
                  figures on this page are this browser tab's own runtime numbers, and they describe the tab —
                  not the machine.
                </p>
              </div>
            </div>
          </div>

          {/* ── 3D scene ──────────────────────────────────────────── */}
          <Panel
            eyebrow="Server hall"
            title="Visualisation of the modelled fleet"
            description="Every element here follows a model input or output. Nothing in this scene is a facility measurement."
            actions={<DataSourceBadge kind="model" size="sm" />}
            bodyClassName="pt-0"
          >
            <SceneFrame
              height={380}
              cameraPosition={[0, 0.9, 2.7]}
              background="#15191B"
              overlay={
                <div className="absolute left-4 bottom-4 bg-graphite/70 backdrop-blur-sm rounded-lg px-3.5 py-2.5">
                  <div className="text-[9px] uppercase tracking-widest text-ivory/40 font-medium mb-1">
                    Modelled
                  </div>
                  <div className="text-[11px] text-ivory/70 leading-relaxed tabular-nums">
                    PUE {round(result.pue, 3)} · {round(result.totalFacilityPowerKw, 1)} kW total
                    <br />
                    {inputs.utilisationPercent}% utilisation · {inputs.renewablePercent}% renewable
                  </div>
                </div>
              }
              caption={
                <>
                  Lit rack units track the modelled utilisation, and their flicker rate rises with it. Airflow
                  particle density scales with the cooling-overhead fraction. The hall's tint runs from warm to
                  sage as the renewable share rises. The ring above the racks is the one measured value here: this
                  browser tab's main-thread load
                  {sample?.mainThreadLoad !== null && sample?.mainThreadLoad !== undefined
                    ? ` (${round(sample.mainThreadLoad * 100, 0)}%)`
                    : ''}
                  . Rack count is a visual sample of the fleet, not one rack per server.
                </>
              }
            >
              <DataCentreScene
                utilisationPercent={inputs.utilisationPercent}
                coolingOverheadFraction={inputs.coolingOverheadFraction}
                renewablePercent={inputs.renewablePercent}
                serverCount={inputs.serverCount}
                browserMainThreadLoad={sample?.mainThreadLoad ?? null}
              />
            </SceneFrame>
          </Panel>

          {/* ── Model results ─────────────────────────────────────── */}
          <Panel
            eyebrow="Model output"
            title="Energy, PUE and emissions"
            description="Calculated from the inputs in the panel to the right. Change any input and every figure here moves with it."
            actions={<DataSourceBadge kind="model" size="sm" />}
            bodyClassName="pt-0"
          >
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard
                  label="PUE"
                  value={round(result.pue, 3)}
                  decimals={3}
                  kind="model"
                  sourceId="terraverse-model"
                  detail="Total facility energy ÷ IT energy"
                  note="The Green Grid / ISO-IEC 30134-2 definition. Because overhead is modelled as a fraction of IT load, this reduces exactly to 1 + the overhead fraction."
                  accentColor={sim.color}
                />
                <MetricCard
                  label="Total facility power"
                  value={round(result.totalFacilityPowerKw, 1)}
                  unit="kW"
                  kind="model"
                  sourceId="terraverse-model"
                  detail={`${round(result.itPowerKw, 1)} kW IT + ${round(result.overheadPowerKw, 1)} kW overhead`}
                />
                <MetricCard
                  label="Annual energy"
                  value={round(result.totalEnergyMwhPerYear, 1)}
                  unit="MWh/yr"
                  kind="model"
                  sourceId="terraverse-model"
                  detail="At continuous load, 8760 h"
                  note="Assumes the modelled load runs continuously all year. Real fleets have diurnal and seasonal variation, so this is an upper bound for a given mean utilisation."
                />
                <MetricCard
                  label="Operational emissions"
                  value={round(result.emissionsTonnesCo2ePerYear, 1)}
                  unit="tCO₂e/yr"
                  kind="model"
                  sourceId="terraverse-model"
                  detail={`${100 - inputs.renewablePercent}% of supply × ${inputs.gridCarbonIntensityGramsPerKwh} g/kWh`}
                  note="Operational only. Embodied carbon from manufacturing and disposing of the hardware is excluded entirely, and for many facilities that is a large share of lifetime emissions."
                  accentColor={sim.color}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                    Power split (kW)
                  </div>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={energyBreakdown} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                      <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={48} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={unitFormatter('kW', { kw: 'Power' })} />
                      <Bar dataKey="kw" radius={[3, 3, 0, 0]}>
                        {energyBreakdown.map((entry) => (
                          <Cell key={entry.label} fill={entry.tone} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-2.5">
                  <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium">
                    Derived figures
                  </div>
                  {[
                    ['Per-server draw at this utilisation', `${round(result.perServerWatts, 0)} W`],
                    ['IT energy', `${round(result.itEnergyMwhPerYear, 1)} MWh/yr`],
                    ['Non-renewable energy', `${round(result.fossilEnergyMwhPerYear, 1)} MWh/yr`],
                    [
                      'Annual electricity cost',
                      `${Math.round(result.annualCost).toLocaleString()} (your currency)`,
                    ],
                    [
                      'Overhead avoided vs PUE 2.0',
                      `${round(result.savingsVsPue2Kw, 1)} kW`,
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3">
                      <span className="text-[11px] text-graphite/55 leading-snug">{label}</span>
                      <span className="text-[12px] font-semibold text-graphite tabular-nums shrink-0">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── The formula chain, verbatim ───────────────────── */}
              <div className="bg-graphite/[0.03] border border-graphite/10 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <Calculator size={12} className="text-graphite/40" />
                  <span className="text-[10px] uppercase tracking-widest text-graphite/40 font-medium">
                    How each figure was obtained
                  </span>
                </div>
                <ol className="space-y-1.5">
                  {steps.map((step, index) => (
                    <li key={step} className="text-[11px] text-graphite/60 leading-relaxed flex gap-2">
                      <span className="text-graphite/30 tabular-nums shrink-0">{index + 1}.</span>
                      <span className="font-mono">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="bg-graphite/[0.03] border border-graphite/10 rounded-lg p-4">
                <div className="text-[10px] uppercase tracking-widest text-graphite/40 font-medium mb-2">
                  Assumptions you must accept for these numbers to mean anything
                </div>
                <ul className="space-y-1.5">
                  {MODEL_ASSUMPTIONS.map((assumption) => (
                    <li key={assumption} className="text-[11px] text-graphite/55 leading-relaxed flex gap-1.5">
                      <span className="text-graphite/25 shrink-0">·</span>
                      <span>{assumption}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="https://www.thegreengrid.org/en/resources/library-and-tools"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-sage hover:underline inline-flex items-center gap-1 mt-2.5"
                >
                  The Green Grid, PUE definition and measurement guidance <ExternalLink size={9} />
                </a>
              </div>
            </div>
          </Panel>

          {/* ── Browser telemetry ─────────────────────────────────── */}
          <Panel
            eyebrow="Measured telemetry"
            title="This browser tab's own runtime figures"
            description="The only genuinely measured values in this module. They describe this tab, because a web page cannot read whole-machine CPU, memory or power."
            actions={
              <>
                <DataSourceBadge kind="observation" size="sm" />
                <button
                  onClick={() => setSampling((value) => !value)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg border border-graphite/15 text-graphite/65 hover:text-graphite hover:border-graphite/30 transition-colors"
                >
                  {sampling ? (
                    <>
                      <Pause size={10} /> Pause
                    </>
                  ) : (
                    <>
                      <Play size={10} /> Resume
                    </>
                  )}
                </button>
              </>
            }
            bodyClassName="pt-0"
          >
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard
                  label="Tab main-thread load"
                  value={sample?.mainThreadLoad === null || sample === null ? null : round(sample.mainThreadLoad * 100, 1)}
                  unit="%"
                  kind="observation"
                  sourceId="browser-telemetry"
                  detail={
                    sample?.framesPerSecond && sample.estimatedRefreshHz
                      ? `${round(sample.framesPerSecond, 1)} of ~${round(sample.estimatedRefreshHz, 0)} fps achieved`
                      : 'Derived from achieved frame rate'
                  }
                  note="Shortfall between the frame rate this tab achieved and the display's apparent refresh rate. This is main-thread saturation FOR THIS TAB — not CPU utilisation, and not a machine measurement."
                  unavailableReason="Frame timing could not be sampled in this environment."
                  accentColor={sim.color}
                />
                <MetricCard
                  label="JS heap in use"
                  value={sample?.jsHeapUsedBytes === null || sample === null ? null : round(sample.jsHeapUsedBytes / (1024 * 1024), 1)}
                  unit="MiB"
                  kind="observation"
                  sourceId="browser-telemetry"
                  detail={
                    sample?.jsHeapLimitBytes
                      ? `Limit ${formatBytes(sample.jsHeapLimitBytes)}`
                      : undefined
                  }
                  note="Chromium-only, deliberately coarsened by the browser, and covers the JS heap alone — not DOM, GPU or renderer-process memory."
                  unavailableReason="This browser does not expose performance.memory. Firefox and Safari withhold it."
                />
                <MetricCard
                  label="Logical cores reported"
                  value={sample?.hardwareConcurrency ?? null}
                  decimals={0}
                  kind="observation"
                  sourceId="browser-telemetry"
                  detail="navigator.hardwareConcurrency"
                  note="Rounded into coarse buckets by the browser to resist fingerprinting, and the browser may report fewer cores than the machine has."
                  unavailableReason="Not exposed by this browser."
                />
                <MetricCard
                  label="Long tasks in window"
                  value={sample?.longTaskCount ?? null}
                  decimals={0}
                  kind="observation"
                  sourceId="browser-telemetry"
                  detail={
                    sample && sample.longTaskTotalMs > 0
                      ? `${round(sample.longTaskTotalMs, 0)} ms blocked`
                      : 'Main-thread tasks over 50 ms'
                  }
                  note="Tasks that blocked the main thread for more than 50 ms during the sampling window. A direct measure of this page's own responsiveness cost."
                  unavailableReason="The Long Tasks API is not available in this browser."
                />
              </div>

              {history.length > 2 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                    Sampled main-thread load over time (%)
                  </div>
                  <ResponsiveContainer width="100%" height={130}>
                    <BarChart
                      data={history.map((entry) => ({
                        at: entry.at,
                        load: entry.load === null ? null : round(entry.load * 100, 1),
                      }))}
                      margin={{ top: 4, right: 4, left: -18, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                      <XAxis dataKey="at" tick={{ ...AXIS_TICK, fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} domain={[0, 100]} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={unitFormatter('%', { load: 'Tab load' })} />
                      <Bar dataKey="load" fill="#4A6356" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="bg-amber/8 border border-amber/25 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Cpu size={12} className="text-amber" />
                  <span className="text-[10px] uppercase tracking-widest text-graphite/45 font-medium">
                    Limits of browser measurement
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {TELEMETRY_LIMITATIONS.map((limitation) => (
                    <li key={limitation} className="text-[11px] text-graphite/60 leading-relaxed flex gap-1.5">
                      <span className="text-graphite/25 shrink-0">·</span>
                      <span>{limitation}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {sample && (
                  <LastUpdated observedAt={sample.at} fetchedAt={sample.at} label="Sampled" />
                )}
                <span className="text-[11px] text-graphite/40">
                  Available APIs:{' '}
                  {Object.entries(capabilities)
                    .filter(([, available]) => available)
                    .map(([name]) => name)
                    .join(', ') || 'none'}
                </span>
              </div>
            </div>
          </Panel>

          <SourcePanel
            sourceId="terraverse-model"
            locationLabel="Not location-dependent — a facility model"
            observedAt={null}
            fetchedAt={new Date().toISOString()}
            notes={[
              'Every value below is computed in this browser from the inputs shown, with no external data source.',
              'PUE follows The Green Grid / ISO-IEC 30134-2: total facility energy divided by IT equipment energy.',
            ]}
            fields={[
              {
                parameter: 'Power Usage Effectiveness',
                value: String(round(result.pue, 3)),
                unit: 'ratio',
                kind: 'model',
              },
              {
                parameter: 'Total facility power at stated utilisation',
                value: String(round(result.totalFacilityPowerKw, 1)),
                unit: 'kW',
                kind: 'model',
              },
              {
                parameter: 'Annual facility energy',
                value: String(round(result.totalEnergyMwhPerYear, 1)),
                unit: 'MWh/yr',
                kind: 'model',
              },
              {
                parameter: 'Annual operational emissions',
                value: String(round(result.emissionsTonnesCo2ePerYear, 1)),
                unit: 'tCO₂e/yr',
                kind: 'model',
              },
            ]}
          />
        </>
      }
      aside={
        <>
          <DataSourceStatus
            entries={[
              {
                sourceId: 'terraverse-model',
                state: 'live',
                detail: 'In-browser calculation from the inputs below.',
              },
              {
                sourceId: 'browser-telemetry',
                state: sample === null ? 'loading' : 'live',
                detail:
                  sample === null
                    ? 'Sampling frame timing…'
                    : `Sampling every 3 s. ${capabilities.jsHeap ? 'Heap available.' : 'Heap not exposed by this browser.'}`,
              },
            ]}
          />

          <Panel
            eyebrow="Model inputs"
            title="Facility parameters"
            description="These are the entire input set. There is nothing hidden behind the results."
            actions={
              <button
                onClick={() => setInputs(DEFAULT_ENERGY_INPUTS)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg border border-graphite/15 text-graphite/60 hover:text-graphite transition-colors"
              >
                <RotateCcw size={10} /> Reset
              </button>
            }
            bodyClassName="space-y-4"
          >
            {(Object.keys(INPUT_METADATA) as (keyof EnergyInputs)[]).map((key) => {
              const meta = INPUT_METADATA[key]
              return (
                <ControlSlider
                  key={key}
                  label={meta.label}
                  value={inputs[key]}
                  min={meta.min}
                  max={meta.max}
                  step={meta.step}
                  unit={` ${meta.unit}`}
                  accentColor={sim.color}
                  onChange={(value) => setInputs((previous) => ({ ...previous, [key]: value }))}
                  note={meta.note}
                />
              )
            })}
          </Panel>

          <div className="bg-white border border-graphite/10 rounded-xl p-5">
            <div className="flex items-start gap-2 mb-2">
              <Activity size={13} className="text-graphite/40 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-1">
                  Reading this module
                </div>
                <h4 className="text-[13px] font-semibold text-graphite">Measured vs calculated</h4>
              </div>
            </div>
            <ul className="space-y-2 text-[11px] text-graphite/55 leading-relaxed">
              <li className="flex gap-1.5">
                <span className="text-graphite/25 shrink-0">·</span>
                <span>
                  <strong className="text-graphite/75">Measured:</strong> frame timing, JS heap, long-task counts,
                  reported core count and device memory — all describing this tab.
                </span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-graphite/25 shrink-0">·</span>
                <span>
                  <strong className="text-graphite/75">Calculated:</strong> power, PUE, energy, emissions and cost
                  — functions of the sliders, nothing else.
                </span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-graphite/25 shrink-0">·</span>
                <span>
                  <strong className="text-graphite/75">Not available at all:</strong> whole-machine CPU, real power
                  draw, temperature, fan state, and any live figure from a real data centre.
                </span>
              </li>
            </ul>
          </div>

          <SceneLegend>
            <LegendRow
              swatch="#8ED2A8"
              label="Lit rack units"
              meaning="modelled fleet utilisation; flicker rate rises with it"
              derived
            />
            <LegendRow
              swatch="#9FC8D8"
              label="Airflow particles"
              meaning="cooling-overhead fraction you set"
              derived
            />
            <LegendRow
              swatch="#64816C"
              label="Hall tint"
              meaning="renewable supply share, warm to sage"
              derived
            />
            <LegendRow
              swatch="#8ED2A8"
              label="Arc above the racks"
              meaning="this browser tab's measured main-thread load"
              derived
            />
            <LegendRow
              swatch="#2E3832"
              label="Rack count"
              meaning="visual sample of the fleet, not one per server"
              derived={false}
            />
          </SceneLegend>
        </>
      }
    />
  )
}
