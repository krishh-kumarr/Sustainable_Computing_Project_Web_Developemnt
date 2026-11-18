import { FlaskConical } from 'lucide-react'

interface Props {
  title?: string
  children: React.ReactNode
  className?: string
}

/**
 * Wraps any user-driven what-if control. Its job is to make unmissable that
 * whatever the sliders do, the result is not a prediction and is not fitted to
 * data.
 */
export default function ScenarioNotice({ title = 'Illustrative scenario', children, className = '' }: Props) {
  return (
    <div className={`bg-graphite/[0.03] border border-graphite/12 rounded-xl p-4 ${className}`}>
      <div className="flex items-start gap-2.5">
        <FlaskConical size={13} className="text-graphite/40 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-graphite/40 font-medium mb-1">{title}</div>
          <div className="text-[12px] text-graphite/55 leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  )
}
