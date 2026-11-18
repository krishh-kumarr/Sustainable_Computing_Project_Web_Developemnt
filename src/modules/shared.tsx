import type { ReactNode } from 'react'
import type { SimulationMeta } from '../data/simulations'

export interface ModuleProps {
  sim: SimulationMeta
}

/** Two-column grid used by every module: content left, controls right. */
export function ModuleLayout({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2 space-y-6 min-w-0">{main}</div>
      <div className="space-y-6 lg:sticky lg:top-24">{aside}</div>
    </div>
  )
}

/** A labelled slider for scenario and model inputs. */
export function ControlSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  note,
  accentColor,
  onChange,
  format,
}: {
  label: ReactNode
  value: number
  min: number
  max: number
  step: number
  unit?: string
  note?: string
  accentColor: string
  onChange: (value: number) => void
  format?: (value: number) => string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <label className="text-[11px] font-medium text-graphite/55 leading-tight">{label}</label>
        <span className="text-[12px] font-semibold text-graphite tabular-nums shrink-0">
          {format ? format(value) : value}
          {unit && <span className="text-graphite/45 font-medium ml-0.5">{unit}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full h-1.5 cursor-pointer"
        style={{ accentColor }}
      />
      {note && <p className="text-[10px] text-graphite/40 leading-snug mt-1">{note}</p>}
    </div>
  )
}

/** Legend entry explaining what one visual element in a 3D scene encodes. */
export function LegendRow({
  swatch,
  label,
  meaning,
  derived,
}: {
  swatch: string
  label: string
  meaning: string
  /** False when the element is decorative rather than data-driven. */
  derived: boolean
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0 mt-1 border border-white/20"
        style={{ backgroundColor: swatch }}
      />
      <span className="min-w-0">
        <span className="text-[11px] font-medium text-graphite/70">{label}</span>
        <span className="text-[11px] text-graphite/45"> — {meaning}</span>
        {!derived && (
          <span className="text-[10px] text-graphite/35 italic"> (decorative, not data)</span>
        )}
      </span>
    </li>
  )
}

export function SceneLegend({ children, title = 'What the scene encodes' }: { children: ReactNode; title?: string }) {
  return (
    <div className="bg-white border border-graphite/10 rounded-xl p-5">
      <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-3">{title}</div>
      <ul className="space-y-2">{children}</ul>
    </div>
  )
}
