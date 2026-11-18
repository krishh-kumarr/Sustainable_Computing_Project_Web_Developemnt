import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ExternalLink, Info, Radio } from 'lucide-react'
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
import CityScene from '../three/scenes/CityScene'
import { useSelectedLocation } from '../context/LocationContext'
import { useAirQualityIndex, useNearbyStations, useStationLatest } from '../services/hooks/useAirQuality'
import { useProxyHealth } from '../services/hooks/useProxyHealth'
import { useUrbanFabric, trafficReadiness } from '../services/hooks/useUrbanData'
import { useWeather } from '../services/hooks/useClimateData'
import { ApiError } from '../services/api/client'
import { POLLUTANT_DESCRIPTION, POLLUTANT_LABEL, type MonitorStation, type Pollutant } from '../services/api/openAq'
import { describeFailure } from '../services/domain/aqi'
import { round } from '../services/data/normalizers/units'
import { LegendRow, ModuleLayout, SceneLegend, type ModuleProps } from './shared'

/** Half-width of the OSM query box, degrees. ~0.02° ≈ a 2.2 km square. */
const FABRIC_RADIUS_DEGREES = 0.02

/**
 * Rendered when the proxy reports no OpenAQ credential. Constructed rather than
 * fetched, because there is no point issuing a request that is certain to 401.
 */
const MISSING_OPENAQ_KEY = new ApiError('unsupported-location', 'Air-quality monitoring is not included in this build.', {
  sourceId: 'openaq',
})

export default function CityModule({ sim }: ModuleProps) {
  const { location, label } = useSelectedLocation()
  const health = useProxyHealth()
  const openAqConfigured = health.envelope?.data.integrations.openaq.configured

  const fabric = useUrbanFabric(location, FABRIC_RADIUS_DEGREES)
  // Hold off until the proxy has answered: issuing the request before we know
  // whether a credential exists just produces a guaranteed 503.
  const stations = useNearbyStations(location, 25_000, openAqConfigured === true)
  const weather = useWeather(location, { forecastDays: 3 })

  const [selectedStation, setSelectedStation] = useState<MonitorStation | null>(null)

  // Default to the nearest station, and follow the location when it changes.
  const nearest = stations.envelope?.data.stations[0] ?? null
  useEffect(() => {
    setSelectedStation(nearest)
  }, [nearest])

  const latest = useStationLatest(selectedStation)
  const assessment = useAirQualityIndex(latest.envelope?.data ?? null)

  const pollutantRows = useMemo(
    () =>
      (latest.envelope?.data.readings ?? []).map((reading) => {
        const sub = assessment.aqi?.subIndices.find((s) => s.parameter === reading.parameter)
        return {
          parameter: POLLUTANT_LABEL[reading.parameter as Pollutant] ?? reading.displayName,
          raw: reading.parameter,
          concentration: round(reading.value, 2),
          unit: reading.unit,
          subIndex: sub?.aqi ?? null,
          tone: sub?.category.tone ?? '#8A8780',
        }
      }),
    [latest.envelope, assessment.aqi],
  )

  const greenRows = useMemo(() => {
    const spaces = fabric.envelope?.data.greenSpaces ?? []
    const byCategory = new Map<string, { hectares: number; count: number }>()
    for (const space of spaces) {
      const entry = byCategory.get(space.category) ?? { hectares: 0, count: 0 }
      entry.hectares += space.areaSquareMetres / 10_000
      entry.count++
      byCategory.set(space.category, entry)
    }
    return [...byCategory.entries()]
      .map(([category, entry]) => ({ category, hectares: round(entry.hectares, 2), count: entry.count }))
      .sort((a, b) => b.hectares - a.hectares)
  }, [fabric.envelope])

  const roadRows = useMemo(() => {
    const roads = fabric.envelope?.data.roads ?? []
    const byClass = new Map<string, number>()
    for (const road of roads) {
      byClass.set(road.classification, (byClass.get(road.classification) ?? 0) + road.lengthMetres)
    }
    const order = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']
    return order
      .filter((classification) => byClass.has(classification))
      .map((classification) => ({
        classification,
        kilometres: round((byClass.get(classification) ?? 0) / 1000, 2),
      }))
  }, [fabric.envelope])

  return (
    <ModuleLayout
      main={
        <>
          {/* ── 3D urban fabric from real OSM geometry ───────────────── */}
          <Panel
            eyebrow="OpenStreetMap geometry"
            title="Urban fabric at this location"
            description={`Road centrelines, building footprint positions and green-space polygons as mapped in OpenStreetMap, within a ${round(FABRIC_RADIUS_DEGREES * 2 * 111, 1)} km square centred on the selected coordinates.`}
            actions={<DataSourceBadge kind="observation" size="sm" />}
            bodyClassName="pt-0"
          >
            <DataStatus
              result={fabric}
              title="OpenStreetMap features"
              sourceId="openstreetmap"
              skeletonHeight={420}
              explanation="Overpass is a shared volunteer service and can be slow or busy. Retrying usually works."
            >
              {(data, meta) => (
                <>
                  <SceneFrame
                    height={420}
                    cameraPosition={[0, 1.9, 2.6]}
                    overlay={
                      <div className="absolute left-4 bottom-4 bg-graphite/70 backdrop-blur-sm rounded-lg px-3.5 py-2.5">
                        <div className="text-[9px] uppercase tracking-widest text-ivory/40 font-medium mb-1">
                          Mapped features drawn
                        </div>
                        <div className="text-[11px] text-ivory/70 tabular-nums leading-relaxed">
                          {data.roads.length} road ways · {data.buildings.length} buildings ·{' '}
                          {data.greenSpaces.length} green spaces
                        </div>
                      </div>
                    }
                    caption={
                      <>
                        Every line and block is real mapped geometry for these coordinates. Building height is
                        drawn <strong>only</strong> where OpenStreetMap records <code>building:levels</code> (at 3 m
                        per storey); untagged footprints are the darker flat plates, because no source tells us how
                        tall they are.
                        {assessment.aqi &&
                          ` The hall tint encodes the measured EPA index of ${assessment.aqi.aqi} — a single index value, not a dispersion model.`}
                      </>
                    }
                  >
                    <CityScene
                      fabric={data}
                      centre={{ lat: location.latitude, lon: location.longitude }}
                      airQualityIndex={assessment.aqi?.aqi ?? null}
                      cloudCoverPercent={weather.envelope?.data.current?.cloudCover ?? null}
                    />
                  </SceneFrame>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                    <MetricCard
                      label="Mapped road density"
                      value={round(data.roadDensityMetresPerSquareKm, 0)}
                      unit="m/km²"
                      decimals={0}
                      kind="observation"
                      sourceId="openstreetmap"
                      detail="Motorway through tertiary"
                      note="Length of mapped major-road centreline divided by the query box's ground area. Minor residential streets are excluded from the query."
                      accentColor={sim.color}
                    />
                    <MetricCard
                      label="Mapped buildings"
                      value={round(data.buildingDensityPerSquareKm, 0)}
                      unit="/km²"
                      decimals={0}
                      kind="observation"
                      sourceId="openstreetmap"
                      detail={`${data.buildings.length} footprints in ${round(data.areaSquareKm, 2)} km²`}
                      note="Counts footprints present in OpenStreetMap. In under-mapped areas this is a lower bound on the real figure."
                    />
                    <MetricCard
                      label="Mapped green cover"
                      value={round(data.mappedGreenCoverPercent, 2)}
                      unit="%"
                      decimals={2}
                      kind="observation"
                      sourceId="openstreetmap"
                      detail={`${round(data.greenAreaHectares, 1)} ha mapped`}
                      note="Share of the query box covered by mapped park, garden, nature-reserve, grass, forest, meadow, recreation-ground and village-green polygons. Street trees and private gardens are usually unmapped."
                    />
                    <MetricCard
                      label="Query box area"
                      value={round(data.areaSquareKm, 2)}
                      unit="km²"
                      decimals={2}
                      kind="model"
                      sourceId="openstreetmap"
                      detail="Ground area the densities divide by"
                      note="Computed from the bounding box using 110.57 km per degree of latitude and 111.32 km per degree of longitude scaled by cos(latitude)."
                    />
                  </div>

                  {(data.truncated.roads || data.truncated.buildings || data.truncated.greenSpaces) && (
                    <div className="mt-4 flex items-start gap-2 bg-amber/8 border border-amber/25 rounded-lg px-3 py-2.5">
                      <AlertTriangle size={12} className="text-amber shrink-0 mt-0.5" />
                      <p className="text-[11px] text-graphite/60 leading-relaxed">
                        The Overpass result hit this app's per-category cap, so the densities above are lower
                        bounds rather than complete counts for the box.
                      </p>
                    </div>
                  )}

                  <div className="mt-4">
                    <LastUpdated
                      observedAt={null}
                      fetchedAt={meta.fetchedAt}
                      stale={meta.stale}
                      label="Features retrieved"
                    />
                    <p className="text-[10px] text-graphite/40 mt-1.5">{data.attribution}</p>
                  </div>
                </>
              )}
            </DataStatus>
          </Panel>

          {/* ── Road and green-space composition ────────────────────── */}
          {fabric.envelope && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Panel
                eyebrow="Road network"
                title="Mapped length by classification"
                description="OpenStreetMap's own highway classification. It describes a road's designated role in the network, and says nothing about how much traffic uses it."
                bodyClassName="pt-0"
              >
                {roadRows.length > 0 ? (
                  <ResponsiveContainer width="100%" height={170}>
                    <BarChart data={roadRows} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                      <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                      <YAxis
                        type="category"
                        dataKey="classification"
                        tick={AXIS_TICK}
                        axisLine={false}
                        tickLine={false}
                        width={74}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={unitFormatter('km', { kilometres: 'Mapped length' })}
                      />
                      <Bar dataKey="kilometres" fill={sim.color} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-[12px] text-graphite/50">
                    No motorway-through-tertiary road is mapped inside this box.
                  </p>
                )}
              </Panel>

              <Panel
                eyebrow="Green space"
                title="Mapped area by type"
                description="Polygon areas computed from the mapped geometry by the shoelace formula on an equirectangular projection."
                bodyClassName="pt-0"
              >
                {greenRows.length > 0 ? (
                  <ul className="space-y-2">
                    {greenRows.map((row) => (
                      <li key={row.category} className="flex items-center justify-between gap-3">
                        <span className="text-[12px] text-graphite/70 capitalize">
                          {row.category.replace(/_/g, ' ')}
                          <span className="text-graphite/35"> · {row.count}</span>
                        </span>
                        <span className="text-[12px] font-semibold text-graphite tabular-nums">
                          {row.hectares} <span className="text-graphite/45 font-medium">ha</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-graphite/50">
                    No park, garden or other green polygon is mapped inside this box. In many cities this reflects
                    incomplete mapping rather than an absence of green space.
                  </p>
                )}
              </Panel>
            </div>
          )}

          {/* ── Air quality ──────────────────────────────────────────── */}
          <Panel
            eyebrow="Air quality"
            title="Nearest monitoring station"
            description="Readings aggregated by OpenAQ from government and research monitors. Coverage follows where monitors exist and report."
            actions={<DataSourceBadge kind="observation" size="sm" />}
            bodyClassName="pt-0"
          >
            {openAqConfigured === false ? (
              <DataUnavailable
                title="OpenAQ air-quality readings"
                sourceId="openaq"
                error={MISSING_OPENAQ_KEY}
                explanation="The backend proxy is running but has no OpenAQ credential, so no air-quality request is made. Nothing is substituted in its place."
              />
            ) : (
              <DataStatus
                result={stations}
                title="nearby monitoring stations"
                sourceId="openaq"
                skeletonHeight={240}
              >
                {(search) => (
                  <div className="space-y-5">
                    {/* Station picker */}
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                        {search.stations.length} station{search.stations.length === 1 ? '' : 's'} within{' '}
                        {round(search.searchRadiusMetres / 1000, 0)} km
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {search.stations.slice(0, 8).map((station) => (
                          <button
                            key={station.locationId}
                            onClick={() => setSelectedStation(station)}
                            className={`text-left px-3 py-2 rounded-lg border text-[11px] transition-colors max-w-[220px] ${
                              selectedStation?.locationId === station.locationId
                                ? 'border-graphite/30 bg-graphite/4'
                                : 'border-graphite/12 hover:border-graphite/25'
                            }`}
                          >
                            <span className="block font-medium text-graphite truncate">{station.name}</span>
                            <span className="block text-graphite/45 mt-0.5 tabular-nums">
                              {station.distanceKm === null ? '—' : `${round(station.distanceKm, 1)} km`}
                              {station.isMonitor === false && ' · low-cost sensor'}
                              {station.sensors.length > 0 && ` · ${station.sensors.length} sensors`}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <DataStatus
                      result={latest}
                      title="the station's latest readings"
                      sourceId="openaq"
                      skeletonHeight={200}
                    >
                      {(snapshot, meta) => (
                        <div className="space-y-5">
                          {/* EPA index */}
                          {assessment.aqi ? (
                            <div
                              className="rounded-xl border p-5"
                              style={{
                                borderColor: `${assessment.aqi.category.tone}40`,
                                backgroundColor: `${assessment.aqi.category.tone}0C`,
                              }}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-4">
                                <div>
                                  <div className="text-[10px] uppercase tracking-widest text-graphite/40 font-medium mb-1">
                                    {assessment.aqi.standard.name}
                                  </div>
                                  <div className="flex items-baseline gap-2">
                                    <span
                                      className="text-[40px] leading-none font-semibold tracking-tight"
                                      style={{ color: assessment.aqi.category.tone }}
                                    >
                                      {assessment.aqi.aqi}
                                    </span>
                                    <span
                                      className="text-sm font-semibold"
                                      style={{ color: assessment.aqi.category.tone }}
                                    >
                                      {assessment.aqi.category.name}
                                    </span>
                                  </div>
                                  <p className="text-[12px] text-graphite/60 mt-2 max-w-md leading-relaxed">
                                    {assessment.aqi.category.healthStatement}
                                  </p>
                                </div>
                                <DataSourceBadge kind="model" size="sm" />
                              </div>

                              <div className="mt-4 pt-3.5 border-t border-graphite/8 space-y-2">
                                <p className="text-[11px] text-graphite/55 leading-relaxed">
                                  Computed as the maximum sub-index over the pollutants this station reports —
                                  the standard's own definition. Driven here by{' '}
                                  <strong className="text-graphite/75">
                                    {POLLUTANT_LABEL[assessment.aqi.dominantParameter as Pollutant] ??
                                      assessment.aqi.dominantParameter}
                                  </strong>
                                  . Breakpoints and formula from{' '}
                                  <a
                                    href={assessment.aqi.standard.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sage hover:underline inline-flex items-center gap-0.5"
                                  >
                                    {assessment.aqi.standard.citation} <ExternalLink size={9} />
                                  </a>
                                  .
                                </p>

                                {assessment.aqi.anyPeriodMismatch && (
                                  <div className="flex items-start gap-2 bg-amber/8 border border-amber/25 rounded-lg px-3 py-2">
                                    <AlertTriangle size={11} className="text-amber shrink-0 mt-0.5" />
                                    <p className="text-[11px] text-graphite/60 leading-relaxed">
                                      <strong>Averaging-period caveat.</strong> The standard defines its
                                      particulate sub-indices over 24-hour means and its O₃ and CO sub-indices
                                      over 8-hour means. OpenAQ's latest endpoint returns the most recent
                                      (typically hourly) value, so for those pollutants the figure above is
                                      computed over a shorter window than the standard specifies. Treat it as
                                      indicative of current conditions, not as a regulatory AQI.
                                    </p>
                                  </div>
                                )}

                                {assessment.aqi.subIndices.some((s) => s.conversionNote) && (
                                  <p className="text-[11px] text-graphite/45 leading-relaxed">
                                    {assessment.aqi.subIndices.find((s) => s.conversionNote)?.conversionNote}
                                  </p>
                                )}

                                {assessment.aqi.failures.length > 0 && (
                                  <ul className="space-y-1">
                                    {assessment.aqi.failures.map((failure) => (
                                      <li
                                        key={failure.parameter}
                                        className="text-[11px] text-graphite/45 leading-relaxed flex gap-1.5"
                                      >
                                        <span className="text-graphite/25">·</span>
                                        <span>{describeFailure(failure)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          ) : (
                            <p className="text-[12px] text-graphite/50">
                              None of this station's reported pollutants has an EPA sub-index that could be
                              computed from the units supplied, so no index is shown.
                            </p>
                          )}

                          {assessment.stale && assessment.ageHours !== null && (
                            <div className="flex items-start gap-2 bg-amber/8 border border-amber/25 rounded-lg px-3 py-2.5">
                              <AlertTriangle size={12} className="text-amber shrink-0 mt-0.5" />
                              <p className="text-[11px] text-graphite/60 leading-relaxed">
                                The newest reading from this station is{' '}
                                {round(assessment.ageHours, 1)} hours old. It is shown with its own measurement
                                timestamp and is not described as live.
                              </p>
                            </div>
                          )}

                          {/* Pollutant concentrations */}
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-3">
                              Measured concentrations
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              {snapshot.readings.map((reading) => {
                                const sub = assessment.aqi?.subIndices.find(
                                  (s) => s.parameter === reading.parameter,
                                )
                                return (
                                  <MetricCard
                                    key={reading.sensorId}
                                    label={POLLUTANT_LABEL[reading.parameter as Pollutant] ?? reading.displayName}
                                    value={round(reading.value, 2)}
                                    unit={reading.unit}
                                    decimals={2}
                                    kind="observation"
                                    sourceId="openaq"
                                    detail={
                                      sub
                                        ? `EPA sub-index ${sub.aqi} · ${sub.category.name}`
                                        : 'No EPA sub-index available'
                                    }
                                    note={POLLUTANT_DESCRIPTION[reading.parameter as Pollutant]}
                                    accentColor={sub?.category.tone}
                                  />
                                )
                              })}
                            </div>
                          </div>

                          {pollutantRows.length > 1 && assessment.aqi && (
                            <div>
                              <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                                EPA sub-index by pollutant
                              </div>
                              <ResponsiveContainer width="100%" height={150}>
                                <BarChart
                                  data={pollutantRows.filter((row) => row.subIndex !== null)}
                                  margin={{ top: 4, right: 4, left: -18, bottom: 0 }}
                                >
                                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                                  <XAxis dataKey="parameter" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
                                  <Tooltip
                                    contentStyle={TOOLTIP_STYLE}
                                    formatter={unitFormatter('', { subIndex: 'EPA sub-index' })}
                                  />
                                  <Bar dataKey="subIndex" radius={[3, 3, 0, 0]}>
                                    {pollutantRows
                                      .filter((row) => row.subIndex !== null)
                                      .map((row) => (
                                        <Cell key={row.raw} fill={row.tone} />
                                      ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          )}

                          {/* Unmonitored / silent pollutants */}
                          {(snapshot.unmonitoredPollutants.length > 0 ||
                            snapshot.silentPollutants.length > 0) && (
                            <div className="bg-graphite/[0.03] border border-graphite/10 rounded-lg p-3.5">
                              <div className="flex items-start gap-2">
                                <Info size={12} className="text-graphite/40 shrink-0 mt-0.5" />
                                <div className="text-[11px] text-graphite/55 leading-relaxed space-y-1">
                                  {snapshot.unmonitoredPollutants.length > 0 && (
                                    <p>
                                      <strong className="text-graphite/70">No sensor:</strong>{' '}
                                      {snapshot.unmonitoredPollutants.map((p) => POLLUTANT_LABEL[p]).join(', ')}.
                                      This station does not measure them, so no value is shown.
                                    </p>
                                  )}
                                  {snapshot.silentPollutants.length > 0 && (
                                    <p>
                                      <strong className="text-graphite/70">Sensor present but silent:</strong>{' '}
                                      {snapshot.silentPollutants.map((p) => POLLUTANT_LABEL[p]).join(', ')}.
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="pt-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-graphite/50">
                              <span className="inline-flex items-center gap-1.5">
                                <Radio size={10} className="text-sage" />
                                <strong className="text-graphite/70">{snapshot.station.name}</strong>
                              </span>
                              {snapshot.station.provider && <span>via {snapshot.station.provider}</span>}
                              {snapshot.station.distanceKm !== null && (
                                <span>{round(snapshot.station.distanceKm, 1)} km from the selected point</span>
                              )}
                              {snapshot.station.isMonitor === false && (
                                <span className="text-amber">Low-cost sensor, not a reference monitor</span>
                              )}
                            </div>
                            <LastUpdated
                              observedAt={meta.observedAt}
                              fetchedAt={meta.fetchedAt}
                              stale={meta.stale}
                            />
                          </div>
                        </div>
                      )}
                    </DataStatus>
                  </div>
                )}
              </DataStatus>
            )}
          </Panel>

          {/* ── Source attribution ──────────────────────────────────── */}
          {latest.envelope && (
            <SourcePanel
              sourceId="openaq"
              locationLabel={`${latest.envelope.data.station.name} — ${label}`}
              observedAt={latest.envelope.observedAt}
              fetchedAt={latest.envelope.fetchedAt}
              stale={latest.envelope.stale}
              notes={latest.envelope.notes}
              fields={latest.envelope.data.readings.map((reading) => ({
                parameter: `${POLLUTANT_LABEL[reading.parameter as Pollutant] ?? reading.displayName} concentration`,
                value: String(round(reading.value, 2)),
                unit: reading.unit,
                kind: 'observation' as const,
              }))}
            />
          )}
        </>
      }
      aside={
        <>
          <DataSourceStatus
            entries={[
              statusFromResult('openstreetmap', fabric, {
                detailWhenLive: `${fabric.envelope?.data.roads.length ?? 0} roads, ${fabric.envelope?.data.buildings.length ?? 0} buildings, ${fabric.envelope?.data.greenSpaces.length ?? 0} green spaces.`,
              }),
              statusFromResult('openaq', latest, {
                keyConfigured: openAqConfigured,
                detailWhenLive: `${latest.envelope?.data.readings.length ?? 0} pollutants from ${latest.envelope?.data.station.name ?? 'the selected station'}.`,
              }),
              statusFromResult('open-meteo-forecast', weather, {
                detailWhenLive: 'Cloud cover, used only for scene lighting.',
              }),
              { sourceId: 'none', state: 'not-integrated', detail: trafficReadiness.note },
            ]}
          />

          <SceneLegend>
            <LegendRow
              swatch="#C25E3A"
              label="Road colour"
              meaning="OpenStreetMap highway classification (motorway through tertiary)"
              derived
            />
            <LegendRow
              swatch="#8E86C8"
              label="Raised blocks"
              meaning="buildings with a mapped building:levels tag, at 3 m per storey"
              derived
            />
            <LegendRow
              swatch="#5C5870"
              label="Flat plates"
              meaning="building footprints with no height tag — drawn flat rather than guessed"
              derived
            />
            <LegendRow
              swatch="#64816C"
              label="Green polygons"
              meaning="mapped parks, gardens, reserves, grass, forest and meadow"
              derived
            />
            <LegendRow
              swatch="#D08A4A"
              label="Hall tint"
              meaning="the measured EPA index value for the selected station"
              derived
            />
            <LegendRow swatch="#2E3740" label="Ground grid" meaning="query-box extent reference" derived={false} />
          </SceneLegend>

          <div className="bg-white border border-graphite/10 rounded-xl p-5">
            <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
              Not integrated
            </div>
            <h4 className="text-[13px] font-semibold text-graphite mb-2">Traffic flow and prediction</h4>
            <p className="text-[12px] text-graphite/55 leading-relaxed">{trafficReadiness.note}</p>
          </div>
        </>
      }
    />
  )
}
