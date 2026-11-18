import { useState } from 'react'
import { Calculator, ChevronDown, FileWarning } from 'lucide-react'

interface Props {
  /** One-paragraph statement of what the model is and is not. */
  disclaimer: string
  /** Assumptions a reader must accept for the output to mean anything. */
  assumptions: string[]
  /** The formula chain behind the current numbers. */
  explain: string[]
  /** Where the engine's starting values came from. */
  provenance: string[]
  className?: string
}

/**
 * Everything needed to audit the numbers on the page: what the model is, what
 * it assumes, where its starting values came from, and the arithmetic that
 * produced its current output.
 */
export default function AssumptionsPanel({
  disclaimer,
  assumptions,
  explain,
  provenance,
  className = '',
}: Props) {
  const [openSection, setOpenSection] = useState<'formula' | 'assumptions' | null>('formula')

  const toggle = (section: 'formula' | 'assumptions') =>
    setOpenSection((current) => (current === section ? null : section))

  return (
    <div className={`bg-white border border-graphite/10 rounded-xl ${className}`}>
      <div className="px-5 pt-5 pb-4 border-b border-graphite/8">
        <div className="flex items-start gap-2.5">
          <FileWarning size={13} className="text-graphite/40 shrink-0 mt-0.5" />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-1">
              What this model is
            </div>
            <p className="text-[12px] text-graphite/60 leading-relaxed">{disclaimer}</p>
          </div>
        </div>
      </div>

      {provenance.length > 0 && (
        <div className="px-5 py-3.5 border-b border-graphite/8">
          <div className="text-[10px] uppercase tracking-wider text-graphite/30 font-medium mb-2">
            Where the starting values came from
          </div>
          <ul className="space-y-1">
            {provenance.map((line) => (
              <li key={line} className="text-[11px] text-graphite/50 leading-relaxed flex gap-1.5">
                <span className="text-graphite/25 shrink-0">·</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-b border-graphite/8">
        <button
          onClick={() => toggle('formula')}
          className="w-full px-5 py-3.5 flex items-center justify-between gap-2 text-left hover:bg-graphite/[0.02] transition-colors"
        >
          <span className="flex items-center gap-2">
            <Calculator size={12} className="text-graphite/40" />
            <span className="text-[11px] font-medium text-graphite/70">
              How the current numbers were obtained
            </span>
          </span>
          <ChevronDown
            size={12}
            className={`text-graphite/35 transition-transform ${openSection === 'formula' ? 'rotate-180' : ''}`}
          />
        </button>
        {openSection === 'formula' && (
          <ol className="px-5 pb-4 space-y-1.5">
            {explain.map((step, index) => (
              <li key={step} className="text-[11px] text-graphite/60 leading-relaxed flex gap-2">
                <span className="text-graphite/30 tabular-nums shrink-0">{index + 1}.</span>
                <span className="font-mono break-words">{step}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <button
          onClick={() => toggle('assumptions')}
          className="w-full px-5 py-3.5 flex items-center justify-between gap-2 text-left hover:bg-graphite/[0.02] transition-colors"
        >
          <span className="text-[11px] font-medium text-graphite/70">
            Assumptions you must accept for these numbers to mean anything
          </span>
          <ChevronDown
            size={12}
            className={`text-graphite/35 transition-transform ${openSection === 'assumptions' ? 'rotate-180' : ''}`}
          />
        </button>
        {openSection === 'assumptions' && (
          <ul className="px-5 pb-5 space-y-1.5">
            {assumptions.map((assumption) => (
              <li key={assumption} className="text-[11px] text-graphite/55 leading-relaxed flex gap-1.5">
                <span className="text-graphite/25 shrink-0">·</span>
                <span>{assumption}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
