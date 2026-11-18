import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Info, Lightbulb, Scale, ShieldAlert, Sparkles } from 'lucide-react'
import { buildReport } from '../../simulation/advisor/advisor.ts'
import { formatMagnitude } from '../../simulation/advisor/helpers.ts'
import type { AdvisorFinding } from '../../simulation/advisor/types.ts'
import type { EngineBaseline, SimulationEngine } from '../../simulation/types/engine.ts'
import type { ParameterValues } from '../../simulation/types/parameters.ts'

interface Props<S, B extends EngineBaseline> {
  engine: SimulationEngine<S, B>
  params: ParameterValues
  baseline: B
  locationLabel: string
  durationHours: number
  accentColor: string
  /** Applies a finding's proposed parameter changes. */
  onApply: (overrides: ParameterValues) => void
  className?: string
}

const KIND_PRESENTATION: Record<
  AdvisorFinding['kind'],
  { label: string; tone: string; background: string; border: string; Icon: typeof Lightbulb }
> = {
  opportunity: { label: 'Opportunity', tone: '#4A6356', background: '#EDF3EE', border: '#64816C33', Icon: Lightbulb },
  'trade-off': { label: 'Trade-off', tone: '#9A6B25', background: '#FBF4E8', border: '#C39A6240', Icon: Scale },
  caution: { label: 'Caution', tone: '#B4453C', background: '#FBEDEC', border: '#B4453C33', Icon: AlertTriangle },
  observation: { label: 'Observation', tone: '#5B6E79', background: '#EEF3F5', border: '#8CA8B533', Icon: Info },
  limitation: { label: 'Limitation', tone: '#6E6A60', background: '#F2F1ED', border: '#25252218', Icon: ShieldAlert },
}

function FindingCard({
  finding,
  accentColor,
  onApply,
}: {
  finding: AdvisorFinding
  accentColor: string
  onApply: (overrides: ParameterValues) => void
}) {
  const [showBasis, setShowBasis] = useState(false)
  const presentation = KIND_PRESENTATION[finding.kind]
  const { Icon } = presentation

  return (
    <li
      className="rounded-xl border p-4"
      style={{ borderColor: presentation.border, backgroundColor: presentation.background }}
    >
      <div className="flex items-start gap-2.5 mb-2">
        <Icon size={13} className="shrink-0 mt-0.5" style={{ color: presentation.tone }} />
        <div className="min-w-0">
          <div
            className="text-[9px] uppercase tracking-widest font-medium mb-0.5"
            style={{ color: presentation.tone }}
          >
            {presentation.label}
          </div>
          <h4 className="text-[13px] font-semibold text-graphite leading-snug">{finding.title}</h4>
        </div>
      </div>

      <p className="text-[12px] text-graphite/65 leading-relaxed mb-3">{finding.detail}</p>

      {finding.magnitudes.length > 0 && (
        <ul className="space-y-1 mb-3">
          {finding.magnitudes.map((entry) => (
            <li key={entry.label} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="text-graphite/50 truncate">{entry.label}</span>
              <span
                className="tabular-nums font-medium shrink-0"
                style={{ color: entry.isImprovement ? '#4A6356' : '#8A8780' }}
              >
                {formatMagnitude(entry)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {finding.action && (
          <button
            onClick={() => onApply(finding.action!.overrides)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: accentColor }}
          >
            {finding.action.label}
          </button>
        )}
        <button
          onClick={() => setShowBasis((value) => !value)}
          className="inline-flex items-center gap-1 text-[11px] text-graphite/45 hover:text-graphite transition-colors"
        >
          Why this appeared
          <ChevronDown
            size={10}
            className={`transition-transform ${showBasis ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {showBasis && (
        <p className="text-[11px] text-graphite/50 leading-relaxed mt-2.5 pt-2.5 border-t border-graphite/8">
          {finding.basis}
        </p>
      )}
    </li>
  )
}

/**
 * The Sustainability Advisor.
 *
 * A rule-based recommendation engine. There is no LLM integration in this
 * application and nothing here is presented as a generated answer: each
 * finding names the rule that produced it, and every quantified benefit was
 * measured by re-running the module's own simulation with the proposed change.
 */
export default function AdvisorPanel<S, B extends EngineBaseline>({
  engine,
  params,
  baseline,
  locationLabel,
  durationHours,
  accentColor,
  onApply,
  className = '',
}: Props<S, B>) {
  const report = useMemo(
    () => buildReport(engine, params, baseline, { locationLabel, durationHours }),
    [engine, params, baseline, locationLabel, durationHours],
  )
  const [showMethod, setShowMethod] = useState(false)

  return (
    <section className={`bg-white border border-graphite/10 rounded-xl ${className}`}>
      <header className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Sparkles size={13} className="text-graphite/40" />
            <span className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium">
              Sustainability Advisor
            </span>
          </div>
          <span className="text-[9px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-graphite/5 text-graphite/45 shrink-0">
            Rule-based
          </span>
        </div>
        <h3 className="text-[15px] font-semibold text-graphite leading-snug">
          {report.findings.length === 0
            ? 'Nothing material to flag in this configuration'
            : `${report.findings.length} finding${report.findings.length === 1 ? '' : 's'} for the current configuration`}
        </h3>
        <button
          onClick={() => setShowMethod((value) => !value)}
          className="inline-flex items-center gap-1 text-[11px] text-graphite/45 hover:text-graphite transition-colors mt-2"
        >
          How these are produced
          <ChevronDown size={10} className={`transition-transform ${showMethod ? 'rotate-180' : ''}`} />
        </button>
        {showMethod && (
          <p className="text-[11px] text-graphite/55 leading-relaxed mt-2 bg-graphite/[0.03] border border-graphite/10 rounded-lg p-3">
            {report.method}
          </p>
        )}
      </header>

      <div className="px-5 pb-5">
        {report.findings.length === 0 ? (
          <p className="text-[12px] text-graphite/50 leading-relaxed">
            No rule triggered on the current parameters. That is not an endorsement of the
            configuration — it means none of this module's rules found a change whose measured effect
            crossed the materiality threshold.
          </p>
        ) : (
          <ul className="space-y-3">
            {report.findings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                accentColor={accentColor}
                onApply={onApply}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
