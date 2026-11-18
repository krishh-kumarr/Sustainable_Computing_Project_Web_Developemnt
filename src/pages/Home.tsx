import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown } from 'lucide-react'
const EarthScene = lazy(() => import('../three/scenes/EarthScene'))
import SimulationCard from '../components/cards/SimulationCard'
import { simulations } from '../data/simulations'
import { DATA_SOURCES, type SourceId } from '../services/config/dataSources'

function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden bg-graphite">
      {/* 3D Earth */}
      <div className="absolute inset-0 flex items-center justify-center opacity-70">
        <div className="w-[600px] h-[600px] md:w-[800px] md:h-[800px]">
          <Suspense fallback={null}>
            <EarthScene />
          </Suspense>
        </div>
      </div>

      {/* Overlay gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-graphite/30 via-transparent to-graphite/80" />
      <div className="absolute inset-0 bg-gradient-to-r from-graphite/60 via-transparent to-graphite/20" />

      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 pt-20">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-2xl"
        >
          <span className="inline-block text-xs font-medium uppercase tracking-widest text-sage mb-6">
            Real environmental data, cited and timestamped
          </span>
          <h1 className="text-5xl md:text-7xl font-semibold text-ivory leading-[1.05] tracking-tight mb-6">
            Understanding tomorrow.{' '}
            <span className="text-sage">Building a sustainable today.</span>
          </h1>
          <p className="text-lg text-ivory/60 leading-relaxed mb-10 max-w-xl">
            Seven interactive environments built on live observations, satellite
            detections and public scientific archives. Every figure names its
            source, its units and when it was measured — and says so plainly when
            no source can supply it.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              to="/explorer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-ivory text-graphite text-sm font-semibold rounded-lg hover:bg-white transition-colors duration-200"
            >
              Explore Simulations <ArrowRight size={15} />
            </Link>
            <Link
              to="/about"
              className="inline-flex items-center gap-2 px-6 py-3 border border-ivory/20 text-ivory/80 text-sm font-medium rounded-lg hover:border-ivory/40 hover:text-ivory transition-colors duration-200"
            >
              Discover TerraVerse
            </Link>
          </div>
        </motion.div>
      </div>

      {/* Scroll cue */}
      <motion.div
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-ivory/30"
        animate={{ y: [0, 6, 0] }}
        transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
      >
        <span className="text-[11px] uppercase tracking-widest">Scroll</span>
        <ChevronDown size={14} />
      </motion.div>
    </section>
  )
}

function SimulationsSection() {
  return (
    <section id="simulations" className="bg-ivory py-28 px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <span className="text-xs uppercase tracking-widest text-sage font-medium">
            Simulation Environments
          </span>
          <h2 className="text-4xl font-semibold text-graphite mt-3 mb-4 leading-tight">
            Seven domains.<br />One platform.
          </h2>
          <p className="text-graphite/50 max-w-xl leading-relaxed">
            Each environment queries real APIs for the location you select, labels
            observations apart from forecasts and model estimates, and reports an
            honest unavailable state rather than filling gaps with invented numbers.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {simulations.map((sim, i) => (
            <SimulationCard key={sim.id} sim={sim} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}

/**
 * Platform facts, not invented performance metrics.
 *
 * The figures this section used to carry — "94% model accuracy", "12 TB
 * training data", "sub-second latency" — described nothing that exists. These
 * are counts of things a reader can go and verify by clicking through.
 */
function StatsSection() {
  const keylessSources = (Object.keys(DATA_SOURCES) as SourceId[]).filter(
    id =>
      id !== 'none' &&
      !['openaq', 'nasa-firms'].includes(id) &&
      !DATA_SOURCES[id].requiresKey &&
      DATA_SOURCES[id].id !== 'terraverse-model',
  ).length
  const stats = [
    {
      value: String(simulations.length),
      label: 'Simulation modules',
      sub: 'Each independently navigable',
    },
    {
      value: String(keylessSources),
      label: 'Sources needing no key',
      sub: 'Open-Meteo, NASA POWER, GBIF, USGS, OSM',
    },
    {
      value: '0',
      label: 'API keys required',
      sub: 'All integrations are credential-free',
    },
    {
      value: '7',
      label: 'Provenance labels',
      sub: 'Every figure carries one',
    },
  ]

  return (
    <section className="bg-graphite py-24 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="border-l border-ivory/10 pl-6"
            >
              <div className="text-3xl font-semibold text-ivory mb-1">{s.value}</div>
              <div className="text-sm font-medium text-ivory/70">{s.label}</div>
              <div className="text-xs text-ivory/30 mt-0.5">{s.sub}</div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="border-t border-ivory/10 pt-8 flex flex-wrap items-start justify-between gap-6"
        >
          <p className="text-sm text-ivory/50 leading-relaxed max-w-xl">
            {keylessSources} public data sources are available automatically for the selected location.
          </p>
          <Link
            to="/data-sources"
            className="inline-flex items-center gap-2 px-5 py-2.5 border border-ivory/20 text-ivory/80 text-sm font-medium rounded-lg hover:border-ivory/40 hover:text-ivory transition-colors shrink-0"
          >
            View live sources <ArrowRight size={14} />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}

export default function Home() {
  return (
    <main>
      <HeroSection />
      <StatsSection />
      <SimulationsSection />
    </main>
  )
}
