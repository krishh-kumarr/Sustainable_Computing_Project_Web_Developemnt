import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ExternalLink, Info, Waves } from 'lucide-react'
import { AXIS_TICK, CHART_GRID_STROKE, TOOLTIP_STYLE, unitFormatter } from '../components/data/chartFormat'
import DataSourceBadge from '../components/data/DataSourceBadge'
import DataSourceStatus, { statusFromResult } from '../components/data/DataSourceStatus'
import DataStatus from '../components/data/DataStatus'
import DataUnavailable from '../components/data/DataUnavailable'
import LastUpdated from '../components/data/LastUpdated'
import MetricCard from '../components/data/MetricCard'
import Panel from '../components/data/Panel'
import ScenarioNotice from '../components/data/ScenarioNotice'
import SourcePanel from '../components/data/SourcePanel'
import SceneFrame from '../three/SceneFrame'
import WaterScene from '../three/scenes/WaterScene'
import { ApiError } from '../services/api/client'
import { useSelectedLocation } from '../context/LocationContext'
import { useWeather } from '../services/hooks/useClimateData'
import { indiaWaterReadiness, useRiverDischarge, useUsgsStations } from '../services/hooks/useWaterData'
import { PARAMETER_CODES } from '../services/api/usgs'
import { round } from '../services/data/normalizers/units'
import { ControlSlider, LegendRow, ModuleLayout, SceneLegend, type ModuleProps } from './shared'

const OUT_OF_USGS_COVERAGE = new ApiError(
  'unsupported-location',
  'USGS gauges cover the United States and its territories only.',
  { sourceId: 'usgs-nwis' },
)

export default function WaterModule({ sim }: ModuleProps) {
  const { location, label } = useSelectedLocation()
  const weather = useWeather(location, { forecastDays: 7, pastDays: 7 })
  const discharge = useRiverDischarge(location, { forecastDays: 14, pastDays: 30 })
  const usgs = useUsgsStations(location)

  /** Scenario water level, used only when no gauge observation exists. */
  const [scenarioLevel, setScenarioLevel] = useState(55)
  const [useScenario, setUseScenario] = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  const dischargeRows = useMemo(
    () =>
      (discharge.envelope?.data.days ?? []).map((day) => ({
        date: day.date.slice(5),
        fullDate: day.date,
        // Split the series so the chart can show where reanalysis ends and
        // forecast begins, rather than drawing one continuous "prediction".
        reanalysis: day.date < today ? day.discharge : null,
        forecast: day.date >= today ? day.discharge : null,
        climatologyMean: day.dischargeMean,
      })),
    [discharge.envelope, today],
  )

  const precipitationRows = useMemo(
    () =>
      (weather.envelope?.data.daily ?? []).map((day) => ({
        date: day.date.slice(5),
        observed: day.date < today ? day.precipitationSum : null,
        forecast: day.date >= today ? day.precipitationSum : null,
      })),
    [weather.envelope, today],
  )

  /** Current rainfall rate — the provider's current-interval precipitation. */
  const currentRainfallMmPerHour = useMemo(() => {
    const current = weather.envelope?.data.current
    if (!current || current.precipitation === null) return null
    // The current block covers a 15-minute interval, so scale to an hourly rate.
    return current.precipitation * 4
  }, [weather.envelope])

  /** Today's modelled discharge, and the series maximum for scaling. */
  const dischargeNow = useMemo(() => {
    const days = discharge.envelope?.data.days ?? []
    const todayRow = days.find((day) => day.date === today) ?? days[days.length - 1]
    const values = days.map((day) => day.discharge).filter((v): v is number => v !== null)
    return {
      value: todayRow?.discharge ?? null,
      max: values.length > 0 ? Math.max(...values) : null,
      unit: discharge.envelope?.data.unit ?? 'm³/s',
    }
  }, [discharge.envelope, today])

  /**
   * Water level for the 3D scene. An observed gauge height is preferred; the
   * scenario slider is used only when no observation exists, and the scene
   * overlay always names which one is in play.
   */
  const gaugeStation = useMemo(() => {
    const stations = usgs.envelope?.data.stations ?? []
    for (const station of stations) {
      const series = station.series.find((s) => s.parameterCode === PARAMETER_CODES.gaugeHeight)
      if (series?.latest) return { station, series }
    }
    return null
  }, [usgs.envelope])

  const sceneLevel = useMemo(() => {
    if (gaugeStation && !useScenario) {
      const readings = gaugeStation.series.readings.map((r) => r.value)
      const min = Math.min(...readings)
      const max = Math.max(...readings)
      const latest = gaugeStation.series.latest!.value
      // Normalised against the station's own range over the retrieved period,
      // because a gauge datum is arbitrary and absolute feet mean nothing here.
      const fraction = max > min ? (latest - min) / (max - min) : 0.5
      return { fraction: 0.15 + fraction * 0.8, provenance: 'observed' as const }
    }
    return { fraction: scenarioLevel / 100, provenance: 'scenario' as const }
  }, [gaugeStation, useScenario, scenarioLevel])

  const isIndia = location.countryCode === 'IN'

  return (
    <ModuleLayout
      main={
        <>
          {/* ── 3D water scene ─────────────────────────────────────── */}
          <Panel
            eyebrow="Hydrological visualisation"
            title="Water scene driven by the retrieved values"
            description="Rainfall particles, surface level and flow speed each follow a specific number from the panels below."
            actions={
              <DataSourceBadge
                kind={sceneLevel.provenance === 'observed' ? 'observation' : 'illustrative'}
                size="sm"
              />
            }
            bodyClassName="pt-0"
          >
            <SceneFrame
              height={400}
              cameraPosition={[0, 1.3, 2.9]}
              overlay={
                <div className="absolute left-4 bottom-4 bg-graphite/70 backdrop-blur-sm rounded-lg px-3.5 py-2.5 max-w-[260px]">
                  <div className="text-[9px] uppercase tracking-widest text-ivory/40 font-medium mb-1">
                    Surface level source
                  </div>
                  <div className="text-[11px] text-ivory/75 leading-relaxed">
                    {sceneLevel.provenance === 'observed' && gaugeStation ? (
                      <>
                        <strong>Observed gauge height</strong> at {gaugeStation.station.siteName}:{' '}
                        {round(gaugeStation.series.latest!.value, 2)} {gaugeStation.series.unit}
                      </>
                    ) : (
                      <>
                        <strong>Illustrative scenario</strong> — {scenarioLevel}% of channel depth. No gauge
                        observation is available here.
                      </>
                    )}
                  </div>
                </div>
              }
              caption={
                <>
                  Rain particle count and fall speed scale with the rainfall rate
                  {currentRainfallMmPerHour === null
                    ? ' (currently unavailable, so no rain is drawn)'
                    : ` (${round(currentRainfallMmPerHour, 1)} mm/h)`}
                  . Flow speed scales with GloFAS river discharge
                  {dischargeNow.value === null
                    ? ' (unavailable here, so the surface is near-still)'
                    : ` (${round(dischargeNow.value, 2)} ${dischargeNow.unit})`}{' '}
                  against this series' own maximum. The wave geometry is a travelling sine field — a cue that the
                  water is moving, not a hydrodynamic solution.
                </>
              }
            >
              <WaterScene
                rainfallMmPerHour={currentRainfallMmPerHour}
                waterLevelFraction={sceneLevel.fraction}
                dischargeCumecs={dischargeNow.value}
                dischargeScaleCumecs={dischargeNow.max}
                levelProvenance={sceneLevel.provenance}
              />
            </SceneFrame>
          </Panel>

          {/* ── River discharge ───────────────────────────────────── */}
          <Panel
            eyebrow="River discharge"
            title="GloFAS discharge: reanalysis and forecast"
            description="Copernicus GloFAS models river discharge on a coarse global grid. Values before today are reanalysis; values from today onward are forecast."
            actions={<DataSourceBadge kind="forecast" size="sm" />}
            bodyClassName="pt-0"
          >
            <DataStatus
              result={discharge}
              title="GloFAS river discharge"
              sourceId="open-meteo-flood"
              skeletonHeight={240}
            >
              {(bundle, meta) =>
                bundle.noRiverCell ? (
                  <div className="space-y-4">
                    <div className="bg-graphite/[0.03] border border-graphite/12 rounded-lg p-4">
                      <div className="flex items-start gap-2.5">
                        <Info size={13} className="text-graphite/40 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-[13px] font-semibold text-graphite mb-1.5">
                            No modelled river in this grid cell
                          </h4>
                          <p className="text-[12px] text-graphite/55 leading-relaxed">
                            GloFAS resolves river channels on a grid, and the cell containing{' '}
                            {location.latitude.toFixed(3)}°, {location.longitude.toFixed(3)}° carries no modelled
                            channel. The API returned its day array with every discharge value null, which is what
                            you see reported here rather than a substituted figure. Coastal cities and locations
                            away from a major river commonly give this result; try a point closer to a large
                            river.
                          </p>
                        </div>
                      </div>
                    </div>
                    <LastUpdated
                      observedAt={null}
                      fetchedAt={meta.fetchedAt}
                      stale={meta.stale}
                      label="Queried"
                    />
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <MetricCard
                        label="Discharge today"
                        value={dischargeNow.value === null ? null : round(dischargeNow.value, 2)}
                        unit={bundle.unit}
                        decimals={2}
                        kind="forecast"
                        sourceId="open-meteo-flood"
                        detail="GloFAS modelled daily mean"
                        note="A grid-cell value from a global hydrological model, not a gauge reading."
                        accentColor={sim.color}
                      />
                      <MetricCard
                        label="Period maximum"
                        value={dischargeNow.max === null ? null : round(dischargeNow.max, 2)}
                        unit={bundle.unit}
                        decimals={2}
                        kind="forecast"
                        sourceId="open-meteo-flood"
                        detail={`Across ${bundle.days.length} days shown`}
                      />
                      <MetricCard
                        label="Days in series"
                        value={bundle.days.length}
                        decimals={0}
                        kind="forecast"
                        sourceId="open-meteo-flood"
                        detail={`${bundle.days[0].date} to ${bundle.days[bundle.days.length - 1].date}`}
                      />
                    </div>

                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={dischargeRows} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                        <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={4} />
                        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={62} />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          formatter={unitFormatter(bundle.unit, {
                            reanalysis: 'GloFAS reanalysis',
                            forecast: 'GloFAS forecast',
                            climatologyMean: 'Long-term daily mean',
                          })}
                        />
                        <ReferenceLine
                          x={today.slice(5)}
                          stroke="#6E6A60"
                          strokeDasharray="4 3"
                          label={{ value: 'today', fontSize: 10, fill: '#6E6A60', position: 'insideTopRight' }}
                        />
                        <Area
                          type="monotone"
                          dataKey="climatologyMean"
                          stroke="#8CA8B5"
                          fill="#8CA8B512"
                          strokeWidth={1.2}
                          strokeDasharray="4 2"
                          connectNulls
                        />
                        <Area
                          type="monotone"
                          dataKey="reanalysis"
                          stroke="#4A6356"
                          fill="#4A635622"
                          strokeWidth={2}
                          connectNulls={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="forecast"
                          stroke={sim.color}
                          fill={`${sim.color}22`}
                          strokeWidth={2}
                          strokeDasharray="5 3"
                          connectNulls={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
                      <span className="inline-flex items-center gap-1.5 text-graphite/55">
                        <span className="w-4 h-0.5 bg-[#4A6356]" /> Reanalysis (before today)
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-graphite/55">
                        <span className="w-4 border-t-2 border-dashed" style={{ borderColor: sim.color }} />{' '}
                        Forecast (today onward)
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-graphite/55">
                        <span className="w-4 border-t border-dashed border-[#8CA8B5]" /> Long-term daily mean
                      </span>
                    </div>

                    <LastUpdated
                      observedAt={null}
                      fetchedAt={meta.fetchedAt}
                      stale={meta.stale}
                      label="Forecast retrieved"
                    />
                  </div>
                )
              }
            </DataStatus>
          </Panel>

          {/* ── USGS gauge observations ───────────────────────────── */}
          <Panel
            eyebrow="Gauge observations"
            title="USGS streamflow and gauge height"
            description="Instantaneous values from the USGS National Water Information System. These are physical measurements at a gauge, not model output."
            actions={<DataSourceBadge kind="observation" size="sm" />}
            bodyClassName="pt-0"
          >
            {!usgs.inCoverage ? (
              <div className="space-y-4">
                <DataUnavailable
                  title="USGS gauge readings"
                  sourceId="usgs-nwis"
                  error={OUT_OF_USGS_COVERAGE}
                  explanation={`${label} is outside the USGS gauge network, so no request is made. No substitute gauge reading is generated.`}
                />
                {isIndia && (
                  <div className="bg-white border border-graphite/12 rounded-xl p-5">
                    <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                      Indian water data — investigated, not integrated
                    </div>
                    <p className="text-[12px] text-graphite/55 leading-relaxed mb-3.5">
                      {indiaWaterReadiness.consequence}
                    </p>
                    <ul className="space-y-2.5">
                      {indiaWaterReadiness.sourcesInvestigated.map((source) => (
                        <li key={source.name}>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] font-medium text-sage hover:underline inline-flex items-center gap-0.5"
                          >
                            {source.name} <ExternalLink size={9} />
                          </a>
                          <p className="text-[11px] text-graphite/45 leading-relaxed">{source.finding}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <DataStatus result={usgs} title="USGS gauge readings" sourceId="usgs-nwis" skeletonHeight={240}>
                {(bundle, meta) => (
                  <div className="space-y-5">
                    {bundle.stations.slice(0, 3).map((station) => (
                      <div key={station.siteCode} className="border border-graphite/10 rounded-xl p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                          <div className="min-w-0">
                            <a
                              href={`https://waterdata.usgs.gov/monitoring-location/${station.siteCode}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[13px] font-semibold text-graphite hover:text-sage inline-flex items-center gap-1"
                            >
                              {station.siteName} <ExternalLink size={9} className="text-graphite/35" />
                            </a>
                            <div className="text-[11px] text-graphite/45 mt-0.5 tabular-nums">
                              Site {station.siteCode}
                              {station.distanceKm !== null && ` · ${round(station.distanceKm, 1)} km away`}
                            </div>
                          </div>
                          {station.provisional && (
                            <span className="text-[10px] uppercase tracking-wider font-medium text-amber bg-amber/10 px-2 py-0.5 rounded-full">
                              Provisional
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {station.series.map((series) => (
                            <div key={series.parameterCode}>
                              <MetricCard
                                label={series.parameterName}
                                value={series.latest === null ? null : round(series.latest.value, 2)}
                                unit={series.unit}
                                decimals={2}
                                kind="observation"
                                sourceId="usgs-nwis"
                                detail={
                                  series.latestSi
                                    ? `${round(series.latestSi.value, 2)} ${series.latestSi.unit} · ${series.readings.length} readings over 7 days`
                                    : `${series.readings.length} readings over 7 days`
                                }
                                note={
                                  series.latest?.qualifiers.includes('P')
                                    ? 'Flagged provisional by USGS: subject to revision after review.'
                                    : undefined
                                }
                                accentColor={sim.color}
                              />
                              {series.readings.length > 3 && (
                                <ResponsiveContainer width="100%" height={70}>
                                  <LineChart
                                    data={series.readings.map((reading) => ({
                                      t: reading.dateTime.slice(5, 16),
                                      v: reading.value,
                                    }))}
                                    margin={{ top: 6, right: 2, left: 2, bottom: 0 }}
                                  >
                                    <YAxis hide domain={['dataMin', 'dataMax']} />
                                    <Tooltip
                                      contentStyle={TOOLTIP_STYLE}
                                      formatter={unitFormatter(series.unit, { v: series.parameterName })}
                                    />
                                    <Line
                                      type="monotone"
                                      dataKey="v"
                                      stroke={sim.color}
                                      strokeWidth={1.4}
                                      dot={false}
                                    />
                                  </LineChart>
                                </ResponsiveContainer>
                              )}
                            </div>
                          ))}
                        </div>

                        {latestReadingTime(station) && (
                          <div className="mt-3 pt-2.5 border-t border-graphite/6">
                            <LastUpdated observedAt={latestReadingTime(station)} fetchedAt={meta.fetchedAt} />
                          </div>
                        )}
                      </div>
                    ))}

                    {bundle.disclaimer && (
                      <p className="text-[11px] text-graphite/45 leading-relaxed">{bundle.disclaimer}</p>
                    )}
                  </div>
                )}
              </DataStatus>
            )}
          </Panel>

          {/* ── Precipitation ─────────────────────────────────────── */}
          <Panel
            eyebrow="Precipitation"
            title="Observed and forecast daily rainfall"
            description="The past week is the provider's analysed record; from today onward it is forecast. The two are drawn separately rather than as one line."
            actions={
              <>
                <DataSourceBadge kind="observation" size="sm" />
                <DataSourceBadge kind="forecast" size="sm" />
              </>
            }
            bodyClassName="pt-0"
          >
            <DataStatus result={weather} title="precipitation data" sourceId="open-meteo-forecast" skeletonHeight={200}>
              {(bundle, meta) => (
                <div className="space-y-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={precipitationRows} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                      <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={unitFormatter(bundle.dailyUnits.precipitation_sum ?? 'mm', {
                          observed: 'Observed',
                          forecast: 'Forecast',
                        })}
                      />
                      <Bar dataKey="observed" fill="#4A6356" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="forecast" fill={sim.accentColor} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-graphite/55">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-[#4A6356]" /> Observed (past days)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: sim.accentColor }} />{' '}
                      Forecast
                    </span>
                  </div>
                  <LastUpdated observedAt={meta.observedAt} fetchedAt={meta.fetchedAt} stale={meta.stale} />
                </div>
              )}
            </DataStatus>
          </Panel>

          {discharge.envelope && !discharge.envelope.data.noRiverCell && (
            <SourcePanel
              sourceId="open-meteo-flood"
              locationLabel={label}
              observedAt={discharge.envelope.observedAt}
              fetchedAt={discharge.envelope.fetchedAt}
              stale={discharge.envelope.stale}
              notes={discharge.envelope.notes}
              fields={[
                {
                  parameter: 'River discharge (today)',
                  value: dischargeNow.value === null ? '—' : String(round(dischargeNow.value, 2)),
                  unit: dischargeNow.unit,
                  kind: 'forecast',
                },
                {
                  parameter: 'River discharge, long-term daily mean',
                  value:
                    discharge.envelope.data.days.find((day) => day.date === today)?.dischargeMean === null ||
                    discharge.envelope.data.days.find((day) => day.date === today)?.dischargeMean === undefined
                      ? '—'
                      : String(
                          round(
                            discharge.envelope.data.days.find((day) => day.date === today)!.dischargeMean!,
                            2,
                          ),
                        ),
                  unit: dischargeNow.unit,
                  kind: 'historical',
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
              statusFromResult('open-meteo-flood', discharge, {
                detailWhenLive: discharge.envelope?.data.noRiverCell
                  ? 'Responded, but this grid cell has no modelled river.'
                  : `${discharge.envelope?.data.days.length ?? 0} days of discharge.`,
              }),
              usgs.inCoverage
                ? statusFromResult('usgs-nwis', usgs, {
                    detailWhenLive: `${usgs.envelope?.data.stations.length ?? 0} active gauge(s) nearby.`,
                  })
                : {
                    sourceId: 'usgs-nwis' as const,
                    state: 'no-coverage' as const,
                    detail: 'Outside the US gauge network; no request made.',
                  },
              statusFromResult('open-meteo-forecast', weather, {
                detailWhenLive: 'Observed and forecast precipitation.',
              }),
            ]}
          />

          <Panel
            eyebrow="Scenario controls"
            title="Water level"
            description={
              gaugeStation
                ? 'A gauge observation is available, so the scene uses it by default. Switch to the scenario to explore other levels.'
                : 'No gauge observation is available for this location, so the scene runs on this scenario value.'
            }
            bodyClassName="space-y-4"
          >
            {gaugeStation && (
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useScenario}
                  onChange={(event) => setUseScenario(event.target.checked)}
                  className="mt-0.5"
                  style={{ accentColor: sim.color }}
                />
                <span className="text-[11px] text-graphite/60 leading-snug">
                  Override the observed gauge height with the scenario slider
                </span>
              </label>
            )}
            <ControlSlider
              label="Scenario water level"
              value={scenarioLevel}
              min={0}
              max={100}
              step={1}
              unit="% of channel depth"
              accentColor={sim.color}
              onChange={(value) => {
                setScenarioLevel(value)
                if (gaugeStation) setUseScenario(true)
              }}
              note="Drives the 3D surface height only. It is not fed into any calculation and predicts nothing."
            />
            <ScenarioNotice>
              A scenario level is a what-if for the visualisation. It is not a forecast, is not derived from
              discharge, and no flood-risk conclusion should be drawn from it.
            </ScenarioNotice>
          </Panel>

          <SceneLegend>
            <LegendRow
              swatch="#BAE6FD"
              label="Rain particles"
              meaning="count and fall speed scale with the observed rainfall rate"
              derived
            />
            <LegendRow
              swatch="#1E6E95"
              label="Surface height"
              meaning={
                sceneLevel.provenance === 'observed'
                  ? 'observed gauge height, normalised over the station\'s 7-day range'
                  : 'the scenario slider value'
              }
              derived
            />
            <LegendRow
              swatch="#7DD3FC"
              label="Flow speed"
              meaning="GloFAS discharge against this series' maximum"
              derived
            />
            <LegendRow
              swatch="#64816C"
              label="Floor ring colour"
              meaning="sage when the level is observed, grey when it is a scenario"
              derived
            />
            <LegendRow swatch="#3A4A43" label="Channel walls & waves" meaning="geometry, not a solver" derived={false} />
          </SceneLegend>

          <div className="bg-white border border-graphite/10 rounded-xl p-5">
            <div className="flex items-start gap-2 mb-2">
              <Waves size={13} className="text-graphite/40 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-1">
                  Reading this module
                </div>
                <h4 className="text-[13px] font-semibold text-graphite">Measured vs modelled water</h4>
              </div>
            </div>
            <ul className="space-y-2 text-[11px] text-graphite/55 leading-relaxed">
              <li className="flex gap-1.5">
                <span className="text-graphite/25 shrink-0">·</span>
                <span>
                  <strong className="text-graphite/75">USGS readings are measurements</strong> taken at a physical
                  gauge, with the station's own timestamp.
                </span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-graphite/25 shrink-0">·</span>
                <span>
                  <strong className="text-graphite/75">GloFAS discharge is model output</strong> on a coarse grid —
                  reanalysis behind today, forecast ahead of it. It is not a gauge reading even where a gauge
                  exists.
                </span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-graphite/25 shrink-0">·</span>
                <span>
                  <strong className="text-graphite/75">The wave motion is animation.</strong> Nothing in the 3D
                  scene solves a flow equation.
                </span>
              </li>
            </ul>
          </div>
        </>
      }
    />
  )
}

/** Newest reading timestamp across a station's series. */
function latestReadingTime(station: { series: { latest: { dateTime: string } | null }[] }): string | null {
  return (
    station.series
      .map((series) => series.latest?.dateTime)
      .filter((t): t is string => Boolean(t))
      .sort()
      .pop() ?? null
  )
}
