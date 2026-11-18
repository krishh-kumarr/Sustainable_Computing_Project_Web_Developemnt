import { useState } from 'react'
import { motion } from 'framer-motion'
import SimulationCard from '../components/cards/SimulationCard'
import { simulations } from '../data/simulations'

const tags = [
  'All',
  'Climate',
  'Observations',
  'Air quality',
  'Satellite',
  'Urban',
  'Water',
  'Agriculture',
  'Computing',
  'Recycling',
]

export default function Explorer() {
  const [activeTag, setActiveTag] = useState('All')

  const filtered = activeTag === 'All'
    ? simulations
    : simulations.filter(s => s.tags.some(t => t.toLowerCase().includes(activeTag.toLowerCase())))

  return (
    <main className="min-h-screen bg-ivory pt-24 pb-20 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-12"
        >
          <span className="text-xs uppercase tracking-widest text-sage font-medium">
            Simulation Explorer
          </span>
          <h1 className="text-4xl font-semibold text-graphite mt-3 mb-4">
            Choose your environment.
          </h1>
          <p className="text-graphite/50 max-w-lg">
            Pick a domain to query its data sources for the location you select.
            Each card lists the public sources and transparent models used by the module.
          </p>
        </motion.div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 mb-10">
          {tags.map(tag => (
            <button
              key={tag}
              onClick={() => setActiveTag(tag)}
              className={`px-4 py-1.5 text-sm rounded-full border transition-all duration-200 ${
                activeTag === tag
                  ? 'bg-graphite text-ivory border-graphite'
                  : 'border-graphite/15 text-graphite/60 hover:border-graphite/30 hover:text-graphite'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filtered.map((sim, i) => (
            <SimulationCard key={sim.id} sim={sim} index={i} />
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="py-20 text-center text-graphite/40">
            No simulations match this filter.
          </div>
        )}
      </div>
    </main>
  )
}
