import type { ReactNode } from 'react'

interface Props {
  /** Small uppercase eyebrow, matching the platform's editorial pattern. */
  eyebrow?: string
  title: string
  description?: string
  /** Badges or controls aligned to the right of the heading. */
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

/** The standard card shell, so every data panel sits on the same grid. */
export default function Panel({
  eyebrow,
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = '',
}: Props) {
  return (
    <section className={`bg-white border border-graphite/10 rounded-xl ${className}`}>
      <header className="px-6 pt-5 pb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-1">{eyebrow}</div>
          )}
          <h3 className="text-[15px] font-semibold text-graphite leading-snug">{title}</h3>
          {description && (
            <p className="text-[12px] text-graphite/50 leading-relaxed mt-1.5 max-w-prose">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </header>
      <div className={`px-6 pb-6 ${bodyClassName}`}>{children}</div>
    </section>
  )
}
