import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { STATUS_LABEL, type SimulationMeta } from '../../data/simulations'
import { getSource } from '../../services/config/dataSources'

interface Props {
  sim: SimulationMeta
  index: number
}

export default function SimulationCard({ sim, index }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.07 }}
    >
      <Link to={`/simulation/${sim.id}`} className="group block">
        <div className="bg-white border border-graphite/8 rounded-xl p-6 hover:border-graphite/20 hover:shadow-md transition-all duration-300 h-full">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div
              className="w-11 h-11 rounded-lg flex items-center justify-center text-xl"
              style={{ backgroundColor: sim.bgColor }}
            >
              {sim.icon}
            </div>
            <div className="flex items-center gap-2">
              <span
                className="text-[11px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full"
                style={{ color: sim.color, backgroundColor: sim.bgColor }}
              >
                {STATUS_LABEL[sim.status]}
              </span>
              <ArrowUpRight
                size={15}
                className="text-graphite/30 group-hover:text-graphite transition-colors"
              />
            </div>
          </div>

          {/* Title */}
          <h3 className="font-semibold text-graphite text-[15px] mb-1">{sim.title}</h3>
          <p className="text-xs text-graphite/40 uppercase tracking-wide font-medium mb-3">
            {sim.subtitle}
          </p>
          <p className="text-sm text-graphite/60 leading-relaxed mb-5 line-clamp-3">
            {sim.description}
          </p>

          {/* Sources — what this module actually queries. No invented metrics:
              a card cannot honestly show a value for a location not yet chosen. */}
          <div className="pt-4 border-t border-graphite/6">
            <div className="text-[10px] text-graphite/35 uppercase tracking-widest font-medium mb-2">
              Data sources
            </div>
            <ul className="space-y-1">
              {sim.sources
                .filter(sourceId => sourceId !== 'none')
                .slice(0, 3)
                .map(sourceId => {
                  const source = getSource(sourceId)
                  return (
                    <li key={sourceId} className="flex items-baseline gap-1.5 text-[11px]">
                      <span className="text-graphite/65 truncate">{source.name}</span>
                      {source.requiresKey && (
                        <span className="text-amber/90 shrink-0" title={`Requires ${source.keyEnvVar}`}>
                          key
                        </span>
                      )}
                    </li>
                  )
                })}
              {sim.sources.every(sourceId => sourceId === 'none') && (
                <li className="text-[11px] text-graphite/45">No external data source</li>
              )}
            </ul>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mt-4">
            {sim.tags.map(t => (
              <span
                key={t}
                className="text-[11px] px-2 py-0.5 rounded-full border border-graphite/10 text-graphite/50"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </Link>
    </motion.div>
  )
}
