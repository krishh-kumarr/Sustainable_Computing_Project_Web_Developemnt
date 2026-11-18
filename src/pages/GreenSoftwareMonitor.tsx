import { useEffect, useState, useSyncExternalStore } from 'react'
import { Activity, Gauge, Network, RotateCcw, Square, Trash2 } from 'lucide-react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  getGreenMonitorSnapshot,
  resetGreenMonitor,
  subscribeGreenMonitor,
  setTelemetrySample,
  type MonitorSnapshot,
} from '../services/domain/greenMonitor'
import { sampleTelemetry } from '../services/domain/browserTelemetry'

const EMPTY: MonitorSnapshot = getGreenMonitorSnapshot()

function useMonitor() {
  return useSyncExternalStore(subscribeGreenMonitor, getGreenMonitorSnapshot, () => EMPTY)
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function Metric({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Activity }) {
  return (
    <div className="rounded-xl border border-graphite/8 bg-white p-5">
      <Icon size={16} className="text-sage mb-4" />
      <div className="text-2xl font-semibold text-graphite">{value}</div>
      <div className="text-xs font-medium text-graphite/70 mt-1">{label}</div>
      <div className="text-[11px] text-graphite/40 mt-2">{note}</div>
    </div>
  )
}

export default function GreenSoftwareMonitor() {
  const snapshot = useMonitor()
  const [running, setRunning] = useState(false)
  const [samples, setSamples] = useState<{ time: string; fps: number | null; frameTime: number | null }[]>([])
  const [baselineFps, setBaselineFps] = useState<number | null>(null)

  useEffect(() => {
    if (!running) return
    const controller = new AbortController()
    let cancelled = false
    const collect = async () => {
      const sample = await sampleTelemetry(1000, controller.signal)
      if (cancelled) return
      setTelemetrySample(sample)
      if (sample.framesPerSecond !== null) {
        setBaselineFps((current) => current ?? sample.framesPerSecond)
      }
      setSamples((current) => [
        ...current.slice(-29),
        {
          time: new Date(sample.at).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }),
          fps: sample.framesPerSecond,
          frameTime: sample.framesPerSecond ? 1000 / sample.framesPerSecond : null,
        },
      ])
      collect()
    }
    collect()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [running])

  const measuredFps = samples.map((sample) => sample.fps).filter((value): value is number => value !== null)
  const optimisedFpsValues = measuredFps.slice(1)
  const fps = optimisedFpsValues.length > 0
    ? optimisedFpsValues.reduce((sum, value) => sum + value, 0) / optimisedFpsValues.length
    : snapshot.telemetry?.framesPerSecond
  const frameTime = fps ? 1000 / fps : null
  const cacheRate = snapshot.api.cacheHits + snapshot.api.requests > 0
    ? (snapshot.api.cacheHits / (snapshot.api.cacheHits + snapshot.api.requests)) * 100
    : null
  const fpsChange = baselineFps !== null && fps !== null && fps !== undefined
    ? ((fps - baselineFps) / baselineFps) * 100
    : null
  const baselineFrameTime = baselineFps ? 1000 / baselineFps : null
  const frameTimeChange = baselineFrameTime && frameTime
    ? ((frameTime - baselineFrameTime) / baselineFrameTime) * 100
    : null

  const reset = () => {
    setRunning(false)
    setSamples([])
    setBaselineFps(null)
    resetGreenMonitor()
  }

  return (
    <main className="min-h-screen bg-ivory pt-24 pb-20 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="max-w-2xl mb-10">
          <div className="text-xs uppercase tracking-widest text-sage font-medium mb-4">Green Software Engineering</div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-graphite mb-4">Green Software Monitor</h1>
          <p className="text-sm leading-relaxed text-graphite/55">
            A lightweight view of what this browser tab can measure: rendering cadence, network transfer and API cache behaviour.
            Energy use and carbon impact are not exposed by browser APIs and are intentionally not estimated here.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 mb-8">
          <button onClick={() => { setSamples([]); setBaselineFps(null); setRunning(true) }} className="inline-flex items-center gap-2 rounded-lg bg-graphite px-4 py-2.5 text-sm font-medium text-ivory">
            <Gauge size={15} /> Start monitoring
          </button>
          <button onClick={() => setRunning(false)} className="inline-flex items-center gap-2 rounded-lg border border-graphite/12 px-4 py-2.5 text-sm font-medium text-graphite">
            <Square size={14} /> Stop
          </button>
          <button onClick={reset} className="inline-flex items-center gap-2 rounded-lg border border-graphite/12 px-4 py-2.5 text-sm font-medium text-graphite">
            <RotateCcw size={14} /> Reset
          </button>
          <span className="self-center text-xs text-graphite/45">{running ? 'Sampling at 1 Hz' : 'Monitor stopped'}</span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <Metric label="Average FPS" value={fps ? fps.toFixed(1) : '—'} note="Measured in this tab" icon={Activity} />
          <Metric label="Frame time" value={frameTime ? `${frameTime.toFixed(1)} ms` : '—'} note="Derived from measured FPS" icon={Gauge} />
          <Metric label="Network transferred" value={formatBytes(snapshot.api.transferredBytes)} note="Response bodies observed by the API client" icon={Network} />
          <Metric label="API cache hit rate" value={cacheRate === null ? '—' : `${cacheRate.toFixed(0)}%`} note={`${snapshot.api.cacheHits} cached reads`} icon={Trash2} />
        </div>

        <div className="grid lg:grid-cols-[1.4fr_0.6fr] gap-5 mb-8">
          <section className="rounded-xl border border-graphite/8 bg-white p-5">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-graphite">Performance session</h2>
              <span className="text-[11px] text-graphite/40">Measured over time</span>
            </div>
            <div className="h-64">
              {samples.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={samples}>
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="fps" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="ms" orientation="right" tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line yAxisId="fps" type="monotone" dataKey="fps" stroke="#718B72" dot={false} name="FPS" />
                    <Line yAxisId="ms" type="monotone" dataKey="frameTime" stroke="#C49A5A" dot={false} name="Frame time (ms)" />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div className="h-full flex items-center justify-center text-sm text-graphite/35">Start a session to collect samples.</div>}
            </div>
          </section>
          <section className="rounded-xl border border-graphite/8 bg-white p-5">
            <h2 className="font-semibold text-graphite mb-5">Runtime resources</h2>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between"><span className="text-graphite/55">API requests</span><strong>{snapshot.api.requests}</strong></div>
              <div className="flex justify-between"><span className="text-graphite/55">Failed requests</span><strong>{snapshot.api.failedRequests}</strong></div>
              <div className="flex justify-between"><span className="text-graphite/55">Active 3D scenes</span><strong>{snapshot.activeScenes}</strong></div>
              <div className="flex justify-between"><span className="text-graphite/55">Animation loops</span><strong>{snapshot.activeAnimationLoops}</strong></div>
              <div className="flex justify-between"><span className="text-graphite/55">Loaded resources</span><strong>{snapshot.loadedResources ?? 'Unavailable'}</strong></div>
              <div className="flex justify-between"><span className="text-graphite/55">Cleanup events</span><strong>{snapshot.cleanedResources}</strong></div>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-graphite/8 bg-white p-6 mb-8">
          <h2 className="font-semibold text-graphite mb-1">Optimisation impact</h2>
          <p className="text-xs text-graphite/45 mb-5">Measured session baseline is the first completed sample; current values average later samples. This is not a claim about an unoptimised build.</p>
          <div className="grid md:grid-cols-3 gap-5 text-sm">
            <div>
              <div className="text-graphite/50">FPS · baseline → current</div>
              <div className="text-xl font-semibold mt-1">{baselineFps === null || fps === null || fps === undefined ? 'Collecting…' : `${baselineFps.toFixed(1)} → ${fps.toFixed(1)}`}</div>
              <div className="text-xs text-graphite/40 mt-1">{fpsChange === null ? 'Need two samples' : `${fpsChange >= 0 ? '+' : ''}${fpsChange.toFixed(1)}% change`}</div>
            </div>
            <div>
              <div className="text-graphite/50">Frame time · baseline → current</div>
              <div className="text-xl font-semibold mt-1">{baselineFrameTime === null || frameTime === null ? 'Collecting…' : `${baselineFrameTime.toFixed(1)} → ${frameTime.toFixed(1)} ms`}</div>
              <div className="text-xs text-graphite/40 mt-1">{frameTimeChange === null ? 'Need two samples' : `${frameTimeChange >= 0 ? '+' : ''}${frameTimeChange.toFixed(1)}% change`}</div>
            </div>
            <div><div className="text-graphite/50">Energy / carbon</div><div className="text-xl font-semibold mt-1">Not measurable</div></div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-graphite mb-4">Practices implemented</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              ['Route-level lazy loading', 'Implemented', 'Heavy pages are loaded on demand.'],
              ['API response caching', 'Implemented', 'Fresh responses and in-flight requests are shared.'],
              ['Adaptive rendering', 'Implemented', 'Canvas pixel ratio is capped for ordinary devices.'],
              ['Inactive animation pause', 'Implemented', 'Scenes can stop their frame loops when not active.'],
              ['Resource cleanup telemetry', 'Measured where available', 'Browser APIs do not expose all GPU resources.'],
              ['Energy and carbon', 'Unavailable', 'No browser API exposes actual power draw.'],
            ].map(([name, status, detail]) => <div key={name} className="rounded-xl border border-graphite/8 bg-white p-4"><div className="flex justify-between gap-3"><strong className="text-sm">{name}</strong><span className="text-[10px] uppercase tracking-wider text-sage">{status}</span></div><p className="text-xs text-graphite/45 mt-2">{detail}</p></div>)}
          </div>
        </section>
      </div>
    </main>
  )
}
