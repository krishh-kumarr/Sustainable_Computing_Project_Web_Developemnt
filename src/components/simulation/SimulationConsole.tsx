import { Download, Gauge, Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import { SPEED_STEPS, type SimulationController, type SpeedMultiplier } from '../../simulation/state/useSimulation.ts'

interface Props {
  controller: SimulationController<unknown>
  accentColor: string
  timeUnit: 'hours' | 'days' | 'months' | 'years' | 'seconds'
  /** Filename stem for the CSV export. */
  exportName: string
  className?: string
}

const UNIT_LABEL: Record<Props['timeUnit'], string> = {
  seconds: 's',
  hours: 'h',
  days: 'd',
  months: 'mo',
  years: 'yr',
}

function elapsedIn(hours: number, unit: Props['timeUnit']): number {
  switch (unit) {
    case 'seconds':
      return hours * 3600
    case 'hours':
      return hours
    case 'days':
      return hours / 24
    case 'months':
      return hours / 730
    case 'years':
      return hours / 8760
  }
}

/**
 * Transport controls for a running simulation: play, pause, single-step,
 * reset, speed and progress, plus export of the series actually computed.
 */
export default function SimulationConsole({
  controller,
  accentColor,
  timeUnit,
  exportName,
  className = '',
}: Props) {
  const { running, play, pause, reset, stepOnce, speed, setSpeed, progress, elapsedHours, durationHours, complete } =
    controller

  const unit = UNIT_LABEL[timeUnit]
  const elapsed = elapsedIn(elapsedHours, timeUnit)
  const total = elapsedIn(durationHours, timeUnit)
  const decimals = timeUnit === 'years' ? 1 : 0

  const download = () => {
    const csv = controller.exportCsv()
    if (!csv) return
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${exportName}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={`bg-white border border-graphite/10 rounded-xl p-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium">
          Simulation control
        </div>
        <button
          onClick={download}
          className="inline-flex items-center gap-1.5 text-[11px] text-graphite/50 hover:text-graphite transition-colors"
          title="Download the computed time series as CSV, with the parameters in the header"
        >
          <Download size={11} /> Export CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={running ? pause : play}
          disabled={complete && !running}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold rounded-lg text-white transition-opacity disabled:opacity-35 disabled:cursor-not-allowed"
          style={{ backgroundColor: accentColor }}
        >
          {running ? (
            <>
              <Pause size={12} /> Pause
            </>
          ) : (
            <>
              <Play size={12} /> {complete ? 'Complete' : elapsedHours > 0 ? 'Resume' : 'Run'}
            </>
          )}
        </button>
        <button
          onClick={stepOnce}
          disabled={running || complete}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-lg border border-graphite/15 text-graphite/65 hover:text-graphite hover:border-graphite/30 transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
          title="Advance exactly one tick"
        >
          <SkipForward size={11} /> Step
        </button>
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-lg border border-graphite/15 text-graphite/65 hover:text-graphite hover:border-graphite/30 transition-colors"
        >
          <RotateCcw size={11} /> Reset
        </button>
      </div>

      <div className="mb-4">
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <span className="text-[11px] text-graphite/50">Simulated time</span>
          <span className="text-[12px] font-semibold text-graphite tabular-nums">
            {elapsed.toLocaleString(undefined, { maximumFractionDigits: decimals })} / {total.toLocaleString(undefined, { maximumFractionDigits: decimals })}{' '}
            <span className="text-graphite/45 font-medium">{unit}</span>
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-graphite/8 overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-150"
            style={{ width: `${progress * 100}%`, backgroundColor: accentColor }}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Gauge size={11} className="text-graphite/35" />
          <span className="text-[11px] text-graphite/50">Speed</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SPEED_STEPS.map((step) => (
            <button
              key={step}
              onClick={() => setSpeed(step as SpeedMultiplier)}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium tabular-nums transition-colors ${
                speed === step
                  ? 'border-graphite/30 bg-graphite/5 text-graphite'
                  : 'border-graphite/12 text-graphite/50 hover:border-graphite/25'
              }`}
            >
              {step}×
            </button>
          ))}
        </div>
        <p className="text-[10px] text-graphite/40 leading-snug mt-2">
          Speed changes how fast the animation plays, never the result. The engine advances in fixed
          steps, so the same parameters always produce the same trajectory.
        </p>
      </div>
    </div>
  )
}
