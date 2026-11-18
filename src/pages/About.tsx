import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'

const pillars = [
  {
    num: '01',
    title: 'Cited, or absent',
    desc: 'Every figure names the API that produced it, the unit it is in, and when it was measured. Where no source can supply a value, the platform says so instead of filling the gap.',
  },
  {
    num: '02',
    title: 'Observation is not prediction',
    desc: 'Measurements, forecasts, model estimates and user-driven scenarios each carry a distinct label. A seven-day weather forecast is never dressed up as a climate projection.',
  },
  {
    num: '03',
    title: 'Checkable arithmetic',
    desc: 'Where the platform calculates rather than measures — PUE, the EPA air-quality index, an irrigation water balance — the formula, its citation and its assumptions are on screen beside the result.',
  },
]

export default function About() {
  return (
    <main className="min-h-screen bg-ivory pt-24 pb-20 px-6">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-20"
        >
          <span className="text-xs uppercase tracking-widest text-sage font-medium">About TerraVerse AI</span>
          <h1 className="text-5xl font-semibold text-graphite mt-4 mb-6 leading-tight">
            Simulating a more<br />sustainable future.
          </h1>
          <p className="text-lg text-graphite/55 leading-relaxed max-w-2xl">
            TerraVerse AI is an interactive environmental-data platform. It queries
            public scientific APIs for a location you choose, and presents what they
            return with the provenance intact: source, units, observation time, and
            an explicit distinction between what was measured, what was forecast,
            what was calculated and what is simply a what-if.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 mb-24">
          {pillars.map((p, i) => (
            <motion.div
              key={p.num}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="border-t-2 border-graphite/10 pt-6"
            >
              <div className="text-xs text-graphite/30 font-medium mb-3">{p.num}</div>
              <h3 className="text-graphite font-semibold text-[15px] mb-2">{p.title}</h3>
              <p className="text-sm text-graphite/50 leading-relaxed">{p.desc}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="bg-graphite rounded-2xl p-10 mb-20"
        >
          <span className="text-xs uppercase tracking-widest text-sage font-medium">
            Technology Stack
          </span>
          <h2 className="text-3xl font-semibold text-ivory mt-3 mb-8">
            Built for performance.<br />Designed for understanding.
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              ['React 19', 'UI framework'],
              ['Three.js / R3F', '3D rendering'],
              ['Recharts', 'Charts'],
              ['Framer Motion', 'Animation'],
              ['TypeScript', 'Type safety'],
              ['Tailwind CSS', 'Styling'],
              ['Vite', 'Build tool'],
              ['Node http proxy', 'Credential isolation'],
            ].map(([tech, role]) => (
              <div key={tech} className="bg-white/5 rounded-lg p-4 border border-white/8">
                <div className="text-ivory font-medium text-sm mb-0.5">{tech}</div>
                <div className="text-ivory/40 text-xs">{role}</div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="border border-graphite/10 rounded-xl p-8 mb-10"
        >
          <h2 className="text-xl font-semibold text-graphite mb-3">
            What is Sustainable Computing?
          </h2>
          <p className="text-graphite/60 leading-relaxed mb-4">
            Sustainable computing encompasses the design, manufacture, use and disposal
            of computing technology in ways that minimise environmental impact. This includes
            energy-efficient hardware design, software optimisation, renewable-powered data
            centres, responsible e-waste handling and algorithms that respect resource constraints.
          </p>
          <p className="text-graphite/60 leading-relaxed">
            TerraVerse AI explores this dual relationship: computing as a tool to address
            environmental challenges, and computing itself as a system that must become
            more sustainable.
          </p>
        </motion.div>

        {/* What this platform deliberately does not do. */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="border border-graphite/10 rounded-xl p-8"
        >
          <span className="text-xs uppercase tracking-widest text-sage font-medium">
            Scope, stated plainly
          </span>
          <h2 className="text-xl font-semibold text-graphite mt-3 mb-4">
            What this platform does not do
          </h2>
          <ul className="space-y-3 mb-6">
            {[
              'It deploys no trained machine-learning model, and therefore publishes no accuracy figure anywhere.',
              'It makes no long-term climate projection. Weather forecasts here span days, not decades, and are labelled as such.',
              'It reports no deforestation rate, no wildfire probability and no crop yield, because no integrated dataset supports any of them.',
              'It cannot read whole-machine CPU or power from a browser, and does not claim to. The data-centre module is a calculator with its arithmetic exposed.',
              'It never falls back to sample data when a request fails. A failure is shown as a failure.',
            ].map(item => (
              <li key={item} className="flex gap-2.5 text-graphite/60 leading-relaxed">
                <span className="text-sage shrink-0 mt-0.5">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Link
            to="/data-sources"
            className="inline-flex items-center gap-2 text-sm font-medium text-sage hover:underline"
          >
            See every source and every gap <ArrowRight size={14} />
          </Link>
        </motion.div>
      </div>
    </main>
  )
}
