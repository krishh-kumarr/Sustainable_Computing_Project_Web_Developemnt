import { useMemo } from 'react'
import { Link2, RotateCcw } from 'lucide-react'
import type { ParameterSpec, ParameterValues } from '../../simulation/types/parameters.ts'
import { ControlSlider } from '../../modules/shared'

interface Props {
  specs: ParameterSpec[]
  values: ParameterValues
  onChange: (key: string, value: number) => void
  onReset: () => void
  accentColor: string
  /** Keys currently driven by a shared cross-module lever. */
  sharedKeys?: Set<string>
  className?: string
}

/**
 * Renders an engine's parameter set grouped by section, with each control's
 * provenance note underneath it. Parameters bound to a cross-module lever are
 * marked, so it is clear when changing one here changes another module too.
 */
export default function ParameterPanel({
  specs,
  values,
  onChange,
  onReset,
  accentColor,
  sharedKeys,
  className = '',
}: Props) {
  const groups = useMemo(() => {
    const byGroup = new Map<string, ParameterSpec[]>()
    for (const spec of specs) {
      const key = spec.group ?? 'Parameters'
      const bucket = byGroup.get(key) ?? []
      bucket.push(spec)
      byGroup.set(key, bucket)
    }
    return [...byGroup.entries()]
  }, [specs])

  return (
    <div className={`bg-white border border-graphite/10 rounded-xl p-5 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium">
          Simulation parameters
        </div>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg border border-graphite/15 text-graphite/55 hover:text-graphite transition-colors"
        >
          <RotateCcw size={10} /> Defaults
        </button>
      </div>

      <div className="space-y-6">
        {groups.map(([group, groupSpecs]) => (
          <div key={group}>
            <div className="text-[10px] uppercase tracking-wider text-graphite/30 font-medium mb-3 pb-1.5 border-b border-graphite/6">
              {group}
            </div>
            <div className="space-y-4">
              {groupSpecs.map((spec) => {
                const shared = Boolean(spec.sharedKey) && sharedKeys?.has(spec.key)
                const label = (
                  <>
                    {spec.label}
                    {shared && (
                      <span
                        className="inline-flex items-center gap-0.5 ml-1.5 text-[9px] uppercase tracking-wider text-sage"
                        title="Driven by a shared cross-module lever. Changing it here changes it everywhere."
                      >
                        <Link2 size={8} /> shared
                      </span>
                    )}
                    {spec.seededFromObservation && (
                      <span
                        className="ml-1.5 text-[9px] uppercase tracking-wider text-dusty"
                        title="This default was seeded from a real observation for the selected location."
                      >
                        observed
                      </span>
                    )}
                  </>
                )

                if (spec.options) {
                  return (
                    <div key={spec.key}>
                      <label className="block text-[11px] font-medium text-graphite/55 mb-1.5">{label}</label>
                      <select
                        value={values[spec.key]}
                        onChange={(event) => onChange(spec.key, Number(event.target.value))}
                        className="w-full px-3 py-2 text-[12px] rounded-lg border border-graphite/15 bg-white text-graphite focus:outline-none focus:border-sage/50"
                      >
                        {spec.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-graphite/40 leading-snug mt-1.5">{spec.note}</p>
                    </div>
                  )
                }

                return (
                  <ControlSlider
                    key={spec.key}
                    label={label}
                    value={values[spec.key]}
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    unit={spec.unit ? ` ${spec.unit}` : ''}
                    accentColor={accentColor}
                    onChange={(value) => onChange(spec.key, value)}
                    note={spec.note}
                    format={(value) => value.toFixed(spec.decimals ?? 0)}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
