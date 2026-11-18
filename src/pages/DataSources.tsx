import { motion } from 'framer-motion'
import { CheckCircle2, CircleSlash, ExternalLink, Loader2, ServerCrash, XCircle } from 'lucide-react'
import DataSourceBadge from '../components/data/DataSourceBadge'
import {
  DATA_KIND_LABEL,
  DATA_KIND_MEANING,
  DATA_SOURCES,
  MODULE_SOURCES,
  type DataKind,
  type SourceId,
} from '../services/config/dataSources'
import { simulations } from '../data/simulations'
import { useProxyHealth } from '../services/hooks/useProxyHealth'
import { cmip6Readiness } from '../services/hooks/useClimateData'
import { deforestationReadiness, wildfireRiskReadiness } from '../services/hooks/useForestData'
import { indiaWaterReadiness } from '../services/hooks/useWaterData'
import { trafficReadiness } from '../services/hooks/useUrbanData'
import { classifierState } from '../services/domain/wasteClassification'

/**
 * Platform-wide integration status.
 *
 * This page exists so the honest answer to "which of this actually works?" is
 * one click away, rather than something a reader has to infer by clicking
 * through seven modules.
 */

const KIND_ORDER: DataKind[] = [
  'observation',
  'historical',
  'forecast',
  'satellite',
  'model',
  'illustrative',
  'unavailable',
]

const NOT_INTEGRATED = [
  {
    title: 'Long-term climate projection (CMIP6)',
    module: 'Climate Intelligence',
    detail: cmip6Readiness.whatTheUiDoesInstead,
    blockers: cmip6Readiness.blockers,
    link: { label: cmip6Readiness.candidateDataset, url: cmip6Readiness.datasetUrl },
  },
  {
    title: 'Deforestation / forest-cover change',
    module: 'Forest Intelligence',
    detail:
      'No forest-cover-change percentage is published anywhere in the platform, because no such dataset is wired up.',
    blockers: deforestationReadiness.blockers,
    link: {
      label: deforestationReadiness.candidateDatasets[0].name,
      url: deforestationReadiness.candidateDatasets[0].url,
    },
  },
  {
    title: 'Wildfire probability',
    module: 'Forest Intelligence',
    detail: wildfireRiskReadiness.note,
    blockers: [],
    link: null,
  },
  {
    title: 'Live traffic flow and prediction',
    module: 'Smart City',
    detail: trafficReadiness.note,
    blockers: [],
    link: null,
  },
  {
    title: 'Indian river gauge observations',
    module: 'AquaGuard',
    detail: indiaWaterReadiness.consequence,
    blockers: indiaWaterReadiness.sourcesInvestigated.map(
      (source) => `${source.name}: ${source.finding}`,
    ),
    link: {
      label: indiaWaterReadiness.sourcesInvestigated[0].name,
      url: indiaWaterReadiness.sourcesInvestigated[0].url,
    },
  },
  {
    title: 'Waste image classification model',
    module: 'Smart Waste',
    detail:
      'The upload interface, result interface and service layer exist and are validated against a documented response contract. There is no trained model, so no prediction and no accuracy figure is shown.',
    blockers: [
      'Training a credible classifier needs a GPU training run over TrashNet or TACO plus a held-out evaluation — work outside this phase.',
      'A model trained only on TrashNet\'s plain-background images degrades sharply on real cluttered photographs, so a usable classifier needs TACO-style in-context data too.',
    ],
    link: { label: 'TACO dataset', url: 'http://tacodataset.org/' },
  },
  {
    title: 'Live data-centre power telemetry',
    module: 'Green Data Centre',
    detail:
      'No free public API reports power draw for an arbitrary data centre. The module is a transparent calculator instead, beside this browser tab\'s own measured runtime figures.',
    blockers: [
      'Facility-level power comes from DCIM systems, BMS integrations or utility meters — all private to the operator.',
      'A browser cannot read whole-machine CPU, memory or power, by deliberate design of the web platform.',
    ],
    link: null,
  },
]

function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="mb-16"
    >
      <div className="text-xs uppercase tracking-widest text-sage font-medium mb-2">{eyebrow}</div>
      <h2 className="text-2xl font-semibold text-graphite mb-2 leading-tight">{title}</h2>
      {description && <p className="text-graphite/55 leading-relaxed max-w-2xl mb-7">{description}</p>}
      {!description && <div className="mb-7" />}
      {children}
    </motion.section>
  )
}

export default function DataSources() {
  const health = useProxyHealth()
  const classifier = classifierState()

  const proxyUp = health.status === 'success'
  const integrations = health.envelope?.data.integrations

  /** Operational state of each source, as far as this page can determine it. */
  const sourceState = (sourceId: SourceId): { label: string; tone: string; Icon: typeof CheckCircle2 } => {
    const source = DATA_SOURCES[sourceId]
    if (sourceId === 'none') {
      return { label: 'Not applicable', tone: '#8A8780', Icon: CircleSlash }
    }
    if (source.viaProxy && !proxyUp) {
      return { label: 'Proxy unreachable', tone: '#B4453C', Icon: ServerCrash }
    }
    return { label: 'No credential needed', tone: '#4A6356', Icon: CheckCircle2 }
  }

  return (
    <main className="min-h-screen bg-ivory pt-24 pb-20 px-6">
      <div className="max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-16">
          <span className="text-xs uppercase tracking-widest text-sage font-medium">Transparency</span>
          <h1 className="text-4xl md:text-5xl font-semibold text-graphite mt-3 mb-5 leading-tight">
            Every source, and<br />every gap.
          </h1>
          <p className="text-lg text-graphite/55 leading-relaxed max-w-2xl">
            What works, and what is deliberately absent. A platform that claims to be
            data-driven should be able to answer that in one place.
          </p>
        </motion.div>

        {/* ── Proxy status ──────────────────────────────────────── */}
        <Section
          eyebrow="Infrastructure"
          title="Backend proxy"
          description="The local proxy sets the descriptive User-Agent required by the OpenStreetMap Overpass service."
        >
          <div className="bg-white border border-graphite/10 rounded-xl p-6">
            {health.status === 'loading' ? (
              <div className="flex items-center gap-2 text-sm text-graphite/50">
                <Loader2 size={13} className="animate-spin" /> Checking the proxy…
              </div>
            ) : proxyUp && integrations ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-sage" />
                  <span className="text-sm font-semibold text-graphite">
                    Proxy reachable at <code className="font-mono text-[12px]">/api</code>
                  </span>
                </div>
                <ul className="space-y-2.5">
                  {[
                    ['Overpass (OpenStreetMap)', integrations.overpass.configured, null],
                  ].map(([name]) => (
                    <li key={String(name)} className="flex items-start gap-2.5">
                      <CheckCircle2 size={13} className="text-sage shrink-0 mt-0.5" />
                      <span className="text-[13px]">
                        <span className="font-medium text-graphite">{String(name)}</span>
                        <span className="text-graphite/50">
                          {' — available through the local proxy'}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <XCircle size={15} className="text-[#B4453C]" />
                  <span className="text-sm font-semibold text-graphite">Proxy not reachable</span>
                </div>
                <p className="text-[13px] text-graphite/55 leading-relaxed">
                  The OpenStreetMap urban-fabric view goes through it. Start it with{' '}
                  <code className="px-1 py-0.5 bg-graphite/6 rounded font-mono text-[12px]">npm run dev</code>, or
                  on its own with{' '}
                  <code className="px-1 py-0.5 bg-graphite/6 rounded font-mono text-[12px]">
                    npm run dev:proxy
                  </code>
                  . The remaining public providers are reached directly.
                </p>
                <button
                  onClick={health.refetch}
                  className="text-[12px] text-sage hover:underline font-medium"
                >
                  Check again
                </button>
              </div>
            )}
          </div>
        </Section>

        {/* ── Source inventory ─────────────────────────────────── */}
        <Section
          eyebrow="Integrated sources"
          title="What the platform queries"
          description="Each of these is reached by a real HTTP request and renders returned values. Known coverage limits are listed because they determine when a module legitimately has nothing to show."
        >
          <div className="space-y-4">
            {(Object.keys(DATA_SOURCES) as SourceId[])
              .filter((sourceId) => sourceId !== 'none' && !['openaq', 'nasa-firms'].includes(sourceId))
              .map((sourceId) => {
                const source = DATA_SOURCES[sourceId]
                const state = sourceState(sourceId)
                const { Icon } = state
                const usedBy = simulations.filter((sim) =>
                  (MODULE_SOURCES[sim.id] ?? []).includes(sourceId),
                )

                return (
                  <div key={sourceId} className="bg-white border border-graphite/10 rounded-xl p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                      <div className="min-w-0">
                        <a
                          href={source.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[15px] font-semibold text-graphite hover:text-sage inline-flex items-center gap-1.5 transition-colors"
                        >
                          {source.name} <ExternalLink size={11} className="text-graphite/30" />
                        </a>
                        <div className="text-[12px] text-graphite/50 mt-0.5">{source.provider}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Icon size={13} style={{ color: state.tone }} />
                        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: state.tone }}>
                          {state.label}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {source.kinds.map((kind) => (
                        <DataSourceBadge key={kind} kind={kind} />
                      ))}
                      {source.viaProxy && (
                        <span className="text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full border border-graphite/12 text-graphite/45">
                          Via proxy
                        </span>
                      )}
                    </div>

                    {source.coverageNote && (
                      <p className="text-[12px] text-graphite/55 leading-relaxed mb-3">{source.coverageNote}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-3 border-t border-graphite/6 text-[11px]">
                      {usedBy.length > 0 && (
                        <span className="text-graphite/45">
                          Used by{' '}
                          <span className="text-graphite/65">{usedBy.map((sim) => sim.title).join(', ')}</span>
                        </span>
                      )}
                      {source.requiresKey && source.keySignupUrl && (
                        <a
                          href={source.keySignupUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sage hover:underline inline-flex items-center gap-0.5"
                        >
                          Get a free key <ExternalLink size={9} />
                        </a>
                      )}
                    </div>

                    {source.attribution && (
                      <p className="text-[10px] text-graphite/35 leading-relaxed mt-2.5">{source.attribution}</p>
                    )}
                  </div>
                )
              })}
          </div>
        </Section>

        {/* ── Label vocabulary ─────────────────────────────────── */}
        <Section
          eyebrow="Reading the labels"
          title="What each badge means"
          description="Every number in the platform carries one of these. The distinction between them is the whole point."
        >
          <div className="bg-white border border-graphite/10 rounded-xl divide-y divide-graphite/6">
            {KIND_ORDER.map((kind) => (
              <div key={kind} className="px-5 py-4 flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="sm:w-[180px] shrink-0">
                  <DataSourceBadge kind={kind} size="sm" />
                </div>
                <p className="text-[12px] text-graphite/60 leading-relaxed">{DATA_KIND_MEANING[kind]}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Per-module summary ───────────────────────────────── */}
        <Section
          eyebrow="By module"
          title="What each simulation shows"
          description="And, in each case, what it explicitly does not claim."
        >
          <div className="space-y-4">
            {simulations.map((sim) => (
              <div key={sim.id} className="bg-white border border-graphite/10 rounded-xl p-5">
                <div className="flex items-start gap-3 mb-3">
                  <span
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
                    style={{ backgroundColor: sim.bgColor }}
                  >
                    {sim.icon}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-graphite">{sim.title}</h3>
                    <div className="text-[11px] text-graphite/40 uppercase tracking-wide font-medium">
                      {sim.subtitle}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                      Shows
                    </div>
                    <ul className="space-y-1">
                      {sim.shows.map((item) => (
                        <li key={item} className="text-[12px] text-graphite/60 leading-relaxed flex gap-1.5">
                          <span className="text-sage shrink-0">·</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                      Does not claim
                    </div>
                    <p className="text-[12px] text-graphite/60 leading-relaxed">{sim.doesNotClaim}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Not integrated ───────────────────────────────────── */}
        <Section
          eyebrow="Deliberately absent"
          title="What is not integrated, and why"
          description="These are the numbers a prototype is most tempted to invent, because they sound impressive and nobody checks them. Each one is listed here instead."
        >
          <div className="space-y-4">
            {NOT_INTEGRATED.map((entry) => (
              <div key={entry.title} className="bg-white border border-graphite/10 rounded-xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                  <h3 className="text-[14px] font-semibold text-graphite">{entry.title}</h3>
                  <span className="text-[10px] uppercase tracking-wider font-medium text-graphite/40 bg-graphite/4 px-2 py-0.5 rounded-full shrink-0">
                    {entry.module}
                  </span>
                </div>
                <p className="text-[12px] text-graphite/60 leading-relaxed mb-3">{entry.detail}</p>
                {entry.blockers.length > 0 && (
                  <ul className="space-y-1 mb-3">
                    {entry.blockers.map((blocker) => (
                      <li key={blocker} className="text-[11px] text-graphite/45 leading-relaxed flex gap-1.5">
                        <span className="text-graphite/25 shrink-0">·</span>
                        <span>{blocker}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {entry.link && (
                  <a
                    href={entry.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-sage hover:underline inline-flex items-center gap-0.5"
                  >
                    {entry.link.label} <ExternalLink size={9} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* ── Local setup ──────────────────────────────────────── */}
        <Section
          eyebrow="Running this yourself"
          title="Local setup"
          description="All public data integrations work without an account."
        >
          <div className="bg-graphite rounded-2xl p-7 text-ivory">
            <ol className="space-y-5">
              {[
                {
                  step: 'Copy the environment template',
                  body: 'cp .env.example .env',
                  note: 'Secrets stay out of the frontend bundle: they are read only by the backend proxy, never prefixed with VITE_.',
                },
                {
                  step: 'Adjust optional proxy settings',
                  body: 'PROXY_PORT=8787',
                  note: 'The proxy is used for OpenStreetMap requests and does not require credentials.',
                },
                {
                  step: 'Start the app and the proxy together',
                  body: 'npm install && npm run dev',
                  note: 'Vite serves the frontend and proxies OpenStreetMap requests to the local Node process.',
                },
              ].map((item, index) => (
                <li key={item.step} className="flex gap-4">
                  <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[11px] font-semibold shrink-0 mt-0.5">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-ivory mb-1.5">{item.step}</div>
                    <pre className="text-[11px] font-mono bg-black/25 rounded-lg px-3 py-2 mb-2 overflow-x-auto text-ivory/80 whitespace-pre-wrap">
                      {item.body}
                    </pre>
                    <p className="text-[11px] text-ivory/45 leading-relaxed">{item.note}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-6 pt-5 border-t border-white/10">
              <div className="text-[10px] uppercase tracking-widest text-ivory/35 font-medium mb-2">
                Waste classifier
              </div>
              <p className="text-[12px] text-ivory/55 leading-relaxed">
                {classifier.status === 'ready'
                  ? `A model service is configured at ${classifier.endpoint}. Smart Waste will send uploads to it and render whatever it returns, validated against the documented contract.`
                  : 'VITE_WASTE_MODEL_ENDPOINT is unset, so Smart Waste reports that model integration is pending. Point it at a service implementing the documented response contract to enable classification.'}
              </p>
            </div>
          </div>
        </Section>

        {/* ── Attribution ─────────────────────────────────────── */}
        <section className="border-t border-graphite/10 pt-8">
          <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-4">
            Required attributions
          </div>
          <ul className="space-y-2">
            {(Object.keys(DATA_SOURCES) as SourceId[])
              .filter((sourceId) => sourceId !== 'none' && DATA_SOURCES[sourceId].attribution)
              .map((sourceId) => (
                <li key={sourceId} className="text-[11px] text-graphite/45 leading-relaxed">
                  <span className="font-medium text-graphite/60">{DATA_SOURCES[sourceId].name}: </span>
                  {DATA_SOURCES[sourceId].attribution}
                </li>
              ))}
          </ul>
          <p className="text-[11px] text-graphite/40 leading-relaxed mt-4">
            Earth surface, cloud and specular textures are NASA Visible Earth / Blue Marble derivatives
            distributed with the three.js examples, served locally from{' '}
            <code className="font-mono text-[10px]">/textures</code>.
          </p>
          <p className="text-[11px] text-graphite/40 leading-relaxed mt-2">
            Badge vocabulary: {KIND_ORDER.map((kind) => DATA_KIND_LABEL[kind]).join(' · ')}.
          </p>
        </section>
      </div>
    </main>
  )
}
