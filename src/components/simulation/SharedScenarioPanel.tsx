import { useState } from 'react'
import { ChevronDown, Link2, RotateCcw } from 'lucide-react'
import { SHARED_LEVERS, useSharedScenario } from '../../simulation/state/SharedScenarioContext'
import { ControlSlider } from '../../modules/shared'

interface Props {
  accentColor: string
  /** Only show levers this module actually consumes. */
  relevantKeys?: string[]
  className?: string
}

/**
 * The cross-module levers.
 *
 * Four assumptions genuinely belong to more than one model, so they live in
 * one place. The panel lists which modules consume each lever and through what
 * mechanism, because a connection a reader cannot trace is indistinguishable
 * from one that was invented for effect.
 */
export default function SharedScenarioPanel({ accentColor, relevantKeys, className = '' }: Props) {
  const { levers, setLever, reset, modifiedKeys } = useSharedScenario()
  const [expanded, setExpanded] = useState<string | null>(null)

  const shown = relevantKeys
    ? SHARED_LEVERS.filter((lever) => relevantKeys.includes(lever.key))
    : SHARED_LEVERS

  if (shown.length === 0) return null

  return (
    <div className={`bg-white border border-graphite/10 rounded-xl p-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Link2 size={12} className="text-sage" />
          <span className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium">
            Cross-module scenario
          </span>
        </div>
        {modifiedKeys.length > 0 && (
          <button
            onClick={reset}
            className="inline-flex items-center gap-1 text-[11px] text-graphite/45 hover:text-graphite transition-colors"
          >
            <RotateCcw size={10} /> Reset all
          </button>
        )}
      </div>
      <p className="text-[11px] text-graphite/45 leading-relaxed mb-4">
        These assumptions are shared across modules. Changing one here changes it everywhere it is
        consumed, through each model's own documented mechanism.
      </p>

      <div className="space-y-4">
        {shown.map((lever) => (
          <div key={lever.key}>
            <ControlSlider
              label={lever.label}
              value={levers[lever.key]}
              min={lever.min}
              max={lever.max}
              step={lever.step}
              unit={` ${lever.unit}`}
              accentColor={accentColor}
              onChange={(value) => setLever(lever.key, value)}
              note={lever.description}
              format={(value) => value.toFixed(lever.step < 1 ? 1 : 0)}
            />
            <button
              onClick={() => setExpanded((current) => (current === lever.key ? null : lever.key))}
              className="inline-flex items-center gap-1 text-[10px] text-graphite/40 hover:text-graphite transition-colors mt-1"
            >
              Used by {lever.consumers.length} module{lever.consumers.length === 1 ? '' : 's'}
              <ChevronDown
                size={9}
                className={`transition-transform ${expanded === lever.key ? 'rotate-180' : ''}`}
              />
            </button>
            {expanded === lever.key && (
              <ul className="space-y-1.5 mt-2 pl-3 border-l border-graphite/10">
                {lever.consumers.map((consumer) => (
                  <li key={consumer.module} className="text-[10px] leading-relaxed">
                    <span className="font-medium text-graphite/65">{consumer.module}</span>
                    <span className="text-graphite/45"> — {consumer.mechanism}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {modifiedKeys.length > 0 && (
        <p className="text-[10px] text-graphite/40 leading-relaxed mt-4 pt-3 border-t border-graphite/8">
          {modifiedKeys.length} lever{modifiedKeys.length === 1 ? '' : 's'} differ from the default.
          This carries across to the other modules for the rest of the session.
        </p>
      )}
    </div>
  )
}
