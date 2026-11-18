import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ExternalLink, Flame, Leaf } from 'lucide-react'
import { AXIS_TICK, CHART_GRID_STROKE, TOOLTIP_STYLE, unitFormatter } from '../components/data/chartFormat'
import DataSourceBadge from '../components/data/DataSourceBadge'
import DataSourceStatus, { statusFromResult } from '../components/data/DataSourceStatus'
import DataStatus from '../components/data/DataStatus'
import DataUnavailable from '../components/data/DataUnavailable'
import LastUpdated from '../components/data/LastUpdated'
import MetricCard from '../components/data/MetricCard'
import Panel from '../components/data/Panel'
import SourcePanel from '../components/data/SourcePanel'
import SceneFrame from '../three/SceneFrame'
import ForestScene from '../three/scenes/ForestScene'
import { ApiError } from '../services/api/client'
import { useSelectedLocation } from '../context/LocationContext'
import { useWeather } from '../services/hooks/useClimateData'
import { useProxyHealth } from '../services/hooks/useProxyHealth'
import {
  deforestationReadiness,
  useBiodiversity,
  useFireDetections,
  wildfireRiskReadiness,
} from '../services/hooks/useForestData'
import { classBreakdown, speciesTally } from '../services/api/gbif'
import { FIRMS_SOURCES, type FirmsSource } from '../services/api/nasaFirms'
import { kelvinToCelsius, round } from '../services/data/normalizers/units'
import { ControlSlider, LegendRow, ModuleLayout, SceneLegend, type ModuleProps } from './shared'

/** Half-width of the plotted area, degrees. Shared by FIRMS and the scene. */
const SCENE_SPAN_DEGREES = 1.5
/** GBIF is queried over a tighter box, where record density is meaningful. */
const GBIF_SPAN_DEGREES = 0.25

const MISSING_FIRMS_KEY = new ApiError('unsupported-location', 'Satellite fire detections are not included in this build.', {
  sourceId: 'nasa-firms',
})

export default function ForestModule({ sim }: ModuleProps) {
  const { location, label } = useSelectedLocation()
  const health = useProxyHealth()
  const firmsConfigured = health.envelope?.data.integrations.firms.configured

  const [lookbackDays, setLookbackDays] = useState(3)
  const [firmsSource, setFirmsSource] = useState<FirmsSource>('VIIRS_SNPP_NRT')

  const fires = useFireDetections(location, {
    days: lookbackDays,
    radiusDegrees: SCENE_SPAN_DEGREES,
    source: firmsSource,
    // Wait for the proxy's answer; without a map key the request can only 503.
    enabled: firmsConfigured === true,
  })
  const biodiversity = useBiodiversity(location, { radiusDegrees: GBIF_SPAN_DEGREES })
  const weather = useWeather(location, { forecastDays: 3, pastDays: 7 })

  const detections = fires.envelope?.data.detections ?? []
  const occurrences = biodiversity.envelope?.data.records ?? []

  const species = useMemo(() => speciesTally(occurrences, 10), [occurrences])
  const classes = useMemo(() => classBreakdown(occurrences, 7), [occurrences])

  const confidenceRows = useMemo(() => {
    const counts = fires.envelope?.data.byConfidence
    if (!counts) return []
    return [
      { label: 'High', count: counts.high, tone: '#E8502A' },
      { label: 'Nominal', count: counts.nominal, tone: '#E8842A' },
      { label: 'Low', count: counts.low, tone: '#D9B06A' },
      { label: 'Unclassified', count: counts.unknown, tone: '#8A8780' },
    ].filter((row) => row.count > 0)
  }, [fires.envelope])

  /** Recent rainfall, from the past-days window of the forecast request. */
  const recentRainfall = useMemo(() => {
    const daily = weather.envelope?.data.daily ?? []
    const today = new Date().toISOString().slice(0, 10)
    const past = daily.filter((day) => day.date < today && day.precipitationSum !== null)
    if (past.length === 0) return null
    return { totalMm: past.reduce((sum, day) => sum + (day.precipitationSum ?? 0), 0), days: past.length }
  }, [weather.envelope])

  const current = weather.envelope?.data.current ?? null

  return (
    <ModuleLayout
      main={
        <>
          {/* ── 3D scene: real detection and occurrence coordinates ──── */}
          <Panel
            eyebrow="Geographic plot"
            title="Fire detections and biodiversity records in place"
            description={`Each point sits at its own reported latitude and longitude, inside a ${round(SCENE_SPAN_DEGREES * 2 * 111, 0)} km square centred on the selected coordinates.`}
            actions={
              <>
                <DataSourceBadge kind="satellite" size="sm" />
                <DataSourceBadge kind="observation" size="sm" />
              </>
            }
            bodyClassName="pt-0"
          >
            <SceneFrame
              height={420}
              cameraPosition={[0, 2.2, 3.0]}
              overlay={
                <div className="absolute left-4 bottom-4 bg-graphite/70 backdrop-blur-sm rounded-lg px-3.5 py-2.5">
                  <div className="text-[9px] uppercase tracking-widest text-ivory/40 font-medium mb-1">
                    Plotted
                  </div>
                  <div className="text-[11px] text-ivory/70 leading-relaxed tabular-nums">
                    <span className="text-[#E8842A]">●</span> {detections.length} fire detection
                    {detections.length === 1 ? '' : 's'} ({lookbackDays}d)
                    <br />
                    <span className="text-[#BFD9C4]">●</span> {occurrences.length} occurrence record
                    {occurrences.length === 1 ? '' : 's'}
                  </div>
                </div>
              }
              caption={
                <>
                  Ember size and plume height scale with Fire Radiative Power on a log scale against the brightest
                  detection in this set
                  {fires.envelope?.data.totalFrpMegawatts !== null &&
                  fires.envelope?.data.totalFrpMegawatts !== undefined
                    ? ` (${round(Math.max(...detections.map((d) => d.frpMegawatts ?? 0)), 1)} MW)`
                    : ''}
                  ; detections without an FRP value get the smallest size rather than a guessed one. Ember colour is
                  the FIRMS confidence class. The pale points are GBIF occurrence records. The canopy, ground and
                  haze are decorative — no dataset here says where individual trees stand.
                </>
              }
            >
              <ForestScene
                centre={{ latitude: location.latitude, longitude: location.longitude }}
                spanDegrees={SCENE_SPAN_DEGREES}
                detections={detections}
                occurrences={occurrences}
                cloudCoverPercent={current?.cloudCover ?? null}
                relativeHumidityPercent={current?.relativeHumidity ?? null}
              />
            </SceneFrame>
          </Panel>

          {/* ── Fire detections ─────────────────────────────────────── */}
          <Panel
            eyebrow="Satellite fire detections"
            title={`NASA FIRMS — ${FIRMS_SOURCES[firmsSource].label}`}
            description="Pixels where a satellite radiometer measured a thermal anomaly consistent with active burning. These are detections, not confirmed ground fires."
            actions={<DataSourceBadge kind="satellite" size="sm" />}
            bodyClassName="pt-0"
          >
            {firmsConfigured === false ? (
              <DataUnavailable
                title="NASA FIRMS active-fire detections"
                sourceId="nasa-firms"
                error={MISSING_FIRMS_KEY}
                explanation="The proxy is running but has no FIRMS map key, so no detection request is made. No fire count is estimated in its place."
              />
            ) : (
              <DataStatus
                result={fires}
                title="fire detections"
                sourceId="nasa-firms"
                skeletonHeight={240}
              >
                {(bundle, meta) => (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <MetricCard
                        label="Detections"
                        value={bundle.detections.length}
                        decimals={0}
                        kind="satellite"
                        sourceId="nasa-firms"
                        detail={`In the last ${bundle.days} day${bundle.days === 1 ? '' : 's'}`}
                        note="A count of detection pixels, not of distinct fires. One large fire produces many adjacent detections, and repeat overpasses re-detect the same fire."
                        accentColor={sim.color}
                      />
                      <MetricCard
                        label="High-confidence"
                        value={bundle.byConfidence.high}
                        decimals={0}
                        kind="satellite"
                        sourceId="nasa-firms"
                        detail="FIRMS confidence class"
                        note="Confidence is the instrument's certainty that it saw a thermal anomaly. It is not a probability that something is burning on the ground."
                      />
                      <MetricCard
                        label="Total radiative power"
                        value={bundle.totalFrpMegawatts === null ? null : round(bundle.totalFrpMegawatts, 1)}
                        unit="MW"
                        decimals={1}
                        kind="satellite"
                        sourceId="nasa-firms"
                        detail={`Summed over ${bundle.detectionsWithFrp} detections reporting FRP`}
                        unavailableReason="No detection in this set reported a Fire Radiative Power value."
                        note="Fire Radiative Power is the rate of radiant energy release measured in the detection pixel."
                      />
                      <MetricCard
                        label="Pixel resolution"
                        value={bundle.resolutionMetres}
                        unit="m"
                        decimals={0}
                        kind="satellite"
                        sourceId="nasa-firms"
                        detail="Nominal, at nadir"
                        note="Pixel footprint grows toward the edge of the swath, so a detection's location carries at least this much uncertainty."
                      />
                    </div>

                    {bundle.detections.length === 0 ? (
                      <div className="bg-graphite/[0.03] border border-graphite/10 rounded-lg p-4">
                        <p className="text-[12px] text-graphite/60 leading-relaxed">
                          <strong className="text-graphite/80">No detections in this window.</strong> That is a
                          real result, and it is not the same as "no fire". Cloud cover blocks the thermal
                          channels, the satellite only passes over a few times a day, and fires smaller or cooler
                          than the detection threshold go unseen entirely.
                        </p>
                      </div>
                    ) : (
                      <>
                        {confidenceRows.length > 0 && (
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                              Detections by confidence class
                            </div>
                            <ResponsiveContainer width="100%" height={140}>
                              <BarChart data={confidenceRows} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
                                <Tooltip
                                  contentStyle={TOOLTIP_STYLE}
                                  formatter={unitFormatter('', { count: 'Detections' })}
                                />
                                <Bar dataKey="count" fill={sim.color} radius={[3, 3, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        )}

                        {/* Individual detections, with their reported attributes. */}
                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                            Strongest detections
                          </div>
                          <div className="overflow-x-auto -mx-1 px-1">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-graphite/40 text-left">
                                  <th className="font-medium pb-2 pr-3">Acquired (UTC)</th>
                                  <th className="font-medium pb-2 pr-3">Coordinates</th>
                                  <th className="font-medium pb-2 pr-3 text-right">FRP</th>
                                  <th className="font-medium pb-2 pr-3 text-right">Brightness</th>
                                  <th className="font-medium pb-2 pr-3">Confidence</th>
                                  <th className="font-medium pb-2">Instrument</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-graphite/6">
                                {bundle.detections.slice(0, 8).map((detection, index) => (
                                  <tr key={`${detection.latitude}-${detection.longitude}-${index}`}>
                                    <td className="py-2 pr-3 text-graphite/70 tabular-nums whitespace-nowrap">
                                      {detection.acquisitionDate}{' '}
                                      {detection.acquisitionTime
                                        ? `${detection.acquisitionTime.padStart(4, '0').slice(0, 2)}:${detection.acquisitionTime.padStart(4, '0').slice(2, 4)}`
                                        : ''}
                                    </td>
                                    <td className="py-2 pr-3 text-graphite/55 tabular-nums whitespace-nowrap font-mono">
                                      {detection.latitude.toFixed(3)}, {detection.longitude.toFixed(3)}
                                    </td>
                                    <td className="py-2 pr-3 text-right text-graphite/70 tabular-nums">
                                      {detection.frpMegawatts === null
                                        ? '—'
                                        : `${round(detection.frpMegawatts, 1)} MW`}
                                    </td>
                                    <td className="py-2 pr-3 text-right text-graphite/70 tabular-nums">
                                      {detection.brightnessKelvin === null
                                        ? '—'
                                        : `${round(detection.brightnessKelvin, 0)} K`}
                                    </td>
                                    <td className="py-2 pr-3 text-graphite/55 capitalize">
                                      {detection.confidenceClass}
                                      {detection.confidenceRaw && (
                                        <span className="text-graphite/30"> ({detection.confidenceRaw})</span>
                                      )}
                                    </td>
                                    <td className="py-2 text-graphite/55">
                                      {detection.instrument ?? '—'}
                                      {detection.satellite && (
                                        <span className="text-graphite/30"> / {detection.satellite}</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {bundle.detections[0]?.brightnessKelvin !== null &&
                            bundle.detections[0]?.brightnessKelvin !== undefined && (
                              <p className="text-[10px] text-graphite/40 mt-2">
                                Brightness is the pixel's measured brightness temperature. The strongest here is{' '}
                                {round(kelvinToCelsius(bundle.detections[0].brightnessKelvin), 0)} °C — a
                                pixel-average radiance temperature, not a flame temperature.
                              </p>
                            )}
                        </div>
                      </>
                    )}

                    <div className="space-y-2">
                      <LastUpdated
                        observedAt={meta.observedAt}
                        fetchedAt={meta.fetchedAt}
                        stale={meta.stale}
                        label={meta.observedAt ? 'Newest acquisition' : 'Retrieved'}
                      />
                      <ul className="space-y-1">
                        {(fires.envelope?.notes ?? []).map((note) => (
                          <li key={note} className="text-[11px] text-graphite/45 leading-relaxed flex gap-1.5">
                            <span className="text-graphite/25 shrink-0">·</span>
                            <span>{note}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </DataStatus>
            )}
          </Panel>

          {/* ── Fire weather ───────────────────────────────────────── */}
          <Panel
            eyebrow="Fire weather"
            title="Observed conditions behind fire behaviour"
            description="The meteorological inputs a fire-danger model would use. They are shown as measurements; the inference is left to you, because no calibrated fire-danger model is implemented here."
            actions={<DataSourceBadge kind="observation" size="sm" />}
            bodyClassName="pt-0"
          >
            <DataStatus result={weather} title="fire-weather conditions" sourceId="open-meteo-forecast" skeletonHeight={160}>
              {(bundle) => (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard
                      label="Temperature"
                      value={bundle.current?.temperature ?? null}
                      unit={bundle.current?.units.temperature_2m ?? '°C'}
                      kind="observation"
                      sourceId="open-meteo-forecast"
                      detail="At 2 metres"
                      accentColor={sim.color}
                    />
                    <MetricCard
                      label="Relative humidity"
                      value={bundle.current?.relativeHumidity ?? null}
                      unit="%"
                      decimals={0}
                      kind="observation"
                      sourceId="open-meteo-forecast"
                      detail="Low humidity dries fine fuels"
                    />
                    <MetricCard
                      label="Wind speed"
                      value={bundle.current?.windSpeed ?? null}
                      unit={bundle.current?.units.wind_speed_10m ?? 'km/h'}
                      kind="observation"
                      sourceId="open-meteo-forecast"
                      detail="At 10 metres"
                    />
                    <MetricCard
                      label="Rain, past week"
                      value={recentRainfall === null ? null : round(recentRainfall.totalMm, 1)}
                      unit="mm"
                      kind="observation"
                      sourceId="open-meteo-forecast"
                      detail={recentRainfall === null ? undefined : `Over ${recentRainfall.days} days`}
                      unavailableReason="The provider returned no past-days precipitation for this location."
                    />
                  </div>
                  <div className="flex items-start gap-2 bg-graphite/[0.03] border border-graphite/10 rounded-lg px-3.5 py-3">
                    <Flame size={12} className="text-graphite/40 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-graphite/55 leading-relaxed">{wildfireRiskReadiness.note}</p>
                  </div>
                </div>
              )}
            </DataStatus>
          </Panel>

          {/* ── Biodiversity ───────────────────────────────────────── */}
          <Panel
            eyebrow="Biodiversity records"
            title="GBIF occurrence records near this location"
            description={`Occurrence records within a ${round(GBIF_SPAN_DEGREES * 2 * 111, 0)} km square. Each record is an observation or collection event that somebody published — collectively a sample of survey effort, not a census.`}
            actions={<DataSourceBadge kind="observation" size="sm" />}
            bodyClassName="pt-0"
          >
            <DataStatus
              result={biodiversity}
              title="GBIF occurrence records"
              sourceId="gbif"
              skeletonHeight={240}
            >
              {(bundle, meta) => (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard
                      label="Matching records"
                      value={bundle.totalMatching}
                      decimals={0}
                      kind="observation"
                      sourceId="gbif"
                      detail="Total GBIF holds for this box"
                      note="Record counts track where people have surveyed and digitised. A high count means well-studied, not necessarily biodiverse."
                      accentColor={sim.color}
                    />
                    <MetricCard
                      label="Records retrieved"
                      value={bundle.records.length}
                      decimals={0}
                      kind="observation"
                      sourceId="gbif"
                      detail="The page analysed below"
                    />
                    <MetricCard
                      label="Distinct names"
                      value={bundle.distinctSpeciesInPage}
                      decimals={0}
                      kind="observation"
                      sourceId="gbif"
                      detail="Within the retrieved page"
                      note="Distinct scientific names in this page only. It is a lower bound on local species richness, and depends on which records the page happened to contain."
                    />
                    <MetricCard
                      label="Record years"
                      value={bundle.yearRange ? `${bundle.yearRange.from}–${bundle.yearRange.to}` : null}
                      kind="observation"
                      sourceId="gbif"
                      detail="Span of the retrieved page"
                      unavailableReason="None of the retrieved records carries a year."
                    />
                  </div>

                  {species.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2.5">
                          Most-recorded species in this page
                        </div>
                        <ul className="space-y-1.5">
                          {species.map((entry) => (
                            <li key={entry.name} className="flex items-baseline justify-between gap-3">
                              <span className="min-w-0">
                                <span className="text-[12px] text-graphite/75 italic">{entry.name}</span>
                                {entry.vernacular && (
                                  <span className="text-[11px] text-graphite/40"> · {entry.vernacular}</span>
                                )}
                              </span>
                              <span className="text-[11px] text-graphite/55 tabular-nums shrink-0">
                                {entry.count}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2.5">
                          Records by taxonomic class
                        </div>
                        <ResponsiveContainer width="100%" height={Math.max(classes.length * 26, 120)}>
                          <BarChart
                            data={classes}
                            layout="vertical"
                            margin={{ top: 0, right: 8, left: -10, bottom: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                            <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                            <YAxis
                              type="category"
                              dataKey="label"
                              tick={AXIS_TICK}
                              axisLine={false}
                              tickLine={false}
                              width={88}
                            />
                            <Tooltip
                              contentStyle={TOOLTIP_STYLE}
                              formatter={unitFormatter('', { count: 'Records' })}
                            />
                            <Bar dataKey="count" fill="#64816C" radius={[0, 3, 3, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {bundle.datasets.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                        Publishing datasets
                      </div>
                      <ul className="space-y-1">
                        {bundle.datasets.slice(0, 5).map((dataset) => (
                          <li key={dataset.key} className="flex items-baseline justify-between gap-3">
                            <a
                              href={`https://www.gbif.org/dataset/${dataset.key}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-graphite/60 hover:text-sage truncate"
                            >
                              {dataset.name}
                            </a>
                            <span className="text-[11px] text-graphite/40 tabular-nums shrink-0">
                              {dataset.recordCount}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex items-start gap-2 bg-graphite/[0.03] border border-graphite/10 rounded-lg px-3.5 py-3">
                    <Leaf size={12} className="text-graphite/40 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-graphite/55 leading-relaxed">
                      These records depend entirely on observation and reporting coverage. An area with few records
                      may be genuinely species-poor, or simply unsurveyed — GBIF cannot distinguish the two, and
                      neither can this panel.
                    </p>
                  </div>

                  <LastUpdated
                    observedAt={meta.observedAt}
                    fetchedAt={meta.fetchedAt}
                    stale={meta.stale}
                    label="Records retrieved"
                  />
                </div>
              )}
            </DataStatus>
          </Panel>

          {fires.envelope && fires.envelope.data.detections.length > 0 && (
            <SourcePanel
              sourceId="nasa-firms"
              locationLabel={label}
              observedAt={fires.envelope.observedAt}
              fetchedAt={fires.envelope.fetchedAt}
              stale={fires.envelope.stale}
              notes={fires.envelope.notes}
              fields={[
                {
                  parameter: 'Active-fire detection count',
                  value: String(fires.envelope.data.detections.length),
                  unit: `pixels / ${fires.envelope.data.days} d`,
                  kind: 'satellite',
                },
                {
                  parameter: 'Summed Fire Radiative Power',
                  value:
                    fires.envelope.data.totalFrpMegawatts === null
                      ? '—'
                      : String(round(fires.envelope.data.totalFrpMegawatts, 1)),
                  unit: 'MW',
                  kind: 'satellite',
                },
                {
                  parameter: 'Instrument product',
                  value: fires.envelope.data.sourceLabel,
                  unit: '',
                  kind: 'satellite',
                },
              ]}
            />
          )}
        </>
      }
      aside={
        <>
          <DataSourceStatus
            entries={[
              statusFromResult('nasa-firms', fires, {
                keyConfigured: firmsConfigured,
                detailWhenLive: `${detections.length} detection${detections.length === 1 ? '' : 's'} over ${lookbackDays} day${lookbackDays === 1 ? '' : 's'}.`,
              }),
              statusFromResult('gbif', biodiversity, {
                detailWhenLive: `${occurrences.length} of ${biodiversity.envelope?.data.totalMatching.toLocaleString() ?? '?'} records retrieved.`,
              }),
              statusFromResult('open-meteo-forecast', weather, {
                detailWhenLive: 'Fire-weather conditions.',
              }),
            ]}
          />

          <Panel
            eyebrow="Query controls"
            title="Detection window"
            description="FIRMS caps the area endpoint at ten days of lookback."
            bodyClassName="space-y-4"
          >
            <ControlSlider
              label="Lookback window"
              value={lookbackDays}
              min={1}
              max={10}
              step={1}
              unit={lookbackDays === 1 ? ' day' : ' days'}
              accentColor={sim.color}
              onChange={setLookbackDays}
              note="A longer window accumulates more detections, including repeat detections of the same fire."
            />
            <div>
              <div className="text-[11px] font-medium text-graphite/55 mb-2">Satellite product</div>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(FIRMS_SOURCES) as FirmsSource[]).map((source) => (
                  <button
                    key={source}
                    onClick={() => setFirmsSource(source)}
                    className={`px-2.5 py-1 rounded-lg border text-[10px] font-medium transition-colors ${
                      firmsSource === source
                        ? 'border-graphite/30 bg-graphite/5 text-graphite'
                        : 'border-graphite/12 text-graphite/55 hover:border-graphite/25'
                    }`}
                  >
                    {source.replace(/_NRT$/, '').replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-graphite/40 leading-snug mt-2">
                VIIRS resolves 375 m pixels and sees smaller fires; MODIS resolves 1 km but has the longer record.
              </p>
            </div>
          </Panel>

          <SceneLegend>
            <LegendRow
              swatch="#E8502A"
              label="Ember colour"
              meaning="FIRMS confidence class — red high, orange nominal, sand low"
              derived
            />
            <LegendRow
              swatch="#E8842A"
              label="Ember size & plume"
              meaning="Fire Radiative Power, log-scaled against this set's maximum"
              derived
            />
            <LegendRow
              swatch="#BFD9C4"
              label="Pale points"
              meaning="GBIF occurrence records at their reported coordinates"
              derived
            />
            <LegendRow
              swatch="#9FB4A6"
              label="Ground haze"
              meaning="observed relative humidity at the selected location"
              derived
            />
            <LegendRow swatch="#2F4A36" label="Canopy trees" meaning="fixed pseudo-random layout" derived={false} />
          </SceneLegend>

          <div className="bg-white border border-graphite/10 rounded-xl p-5">
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle size={13} className="text-graphite/40 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-1">
                  Not integrated
                </div>
                <h4 className="text-[13px] font-semibold text-graphite">Deforestation rate</h4>
              </div>
            </div>
            <p className="text-[12px] text-graphite/55 leading-relaxed mb-3">
              No forest-cover-change percentage is shown anywhere in this module, because no such dataset is
              wired up. Inventing one would be the easiest number on this page to fake and the hardest for a
              reader to check.
            </p>
            <div className="space-y-2.5">
              {deforestationReadiness.candidateDatasets.map((dataset) => (
                <div key={dataset.name}>
                  <a
                    href={dataset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-medium text-sage hover:underline inline-flex items-center gap-0.5"
                  >
                    {dataset.name} <ExternalLink size={9} />
                  </a>
                  <p className="text-[11px] text-graphite/45 leading-relaxed">{dataset.note}</p>
                </div>
              ))}
              <ul className="space-y-1 pt-1 border-t border-graphite/8">
                {deforestationReadiness.blockers.map((blocker) => (
                  <li key={blocker} className="text-[11px] text-graphite/45 leading-relaxed flex gap-1.5">
                    <span className="text-graphite/25 shrink-0">·</span>
                    <span>{blocker}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      }
    />
  )
}
