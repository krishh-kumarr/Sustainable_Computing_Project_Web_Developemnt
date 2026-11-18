import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ExternalLink, Info } from 'lucide-react'
import { AXIS_TICK, CHART_GRID_STROKE, TOOLTIP_STYLE, unitFormatter } from '../components/data/chartFormat'
import DataSourceBadge from '../components/data/DataSourceBadge'
import DataSourceStatus, { statusFromResult } from '../components/data/DataSourceStatus'
import DataStatus from '../components/data/DataStatus'
import LastUpdated from '../components/data/LastUpdated'
import MetricCard from '../components/data/MetricCard'
import Panel from '../components/data/Panel'
import ScenarioNotice from '../components/data/ScenarioNotice'
import SourcePanel from '../components/data/SourcePanel'
import SceneFrame from '../three/SceneFrame'
import EarthGlobe from '../three/scenes/EarthGlobe'
import { useSelectedLocation } from '../context/LocationContext'
import { cmip6Readiness, useHistoricalClimate, usePowerDaily, useWeather } from '../services/hooks/useClimateData'
import { describeWeatherCode } from '../services/api/openMeteo'
import { mjPerM2DayToKwhPerM2Day, round } from '../services/data/normalizers/units'
import { ControlSlider, LegendRow, ModuleLayout, SceneLegend, type ModuleProps } from './shared'

export default function ClimateModule({ sim }: ModuleProps) {
  const { location, label } = useSelectedLocation()
  const weather = useWeather(location, { forecastDays: 7 })
  const historical = useHistoricalClimate(location, 5)
  const power = usePowerDaily(location, 90)

  /**
   * Scenario offsets. These shift the observed record by a fixed amount so the
   * reader can see sensitivity. They are not projections and are labelled
   * ILLUSTRATIVE SCENARIO wherever their output appears.
   */
  const [temperatureOffset, setTemperatureOffset] = useState(0)
  const [precipitationScale, setPrecipitationScale] = useState(100)

  const current = weather.envelope?.data.current ?? null
  const units = current?.units ?? {}

  const forecastRows = useMemo(
    () =>
      (weather.envelope?.data.daily ?? []).map((day) => ({
        date: day.date.slice(5),
        max: day.temperatureMax,
        min: day.temperatureMin,
        precipitation: day.precipitationSum,
        probability: day.precipitationProbabilityMax,
      })),
    [weather.envelope],
  )

  const monthlyRows = useMemo(() => {
    const monthly = historical.envelope?.data.monthly ?? []
    return monthly.map((row) => ({
      month: row.month,
      observedTemperature: row.temperatureMean === null ? null : round(row.temperatureMean, 2),
      scenarioTemperature:
        row.temperatureMean === null ? null : round(row.temperatureMean + temperatureOffset, 2),
      observedPrecipitation: row.precipitationSum === null ? null : round(row.precipitationSum, 1),
      scenarioPrecipitation:
        row.precipitationSum === null ? null : round(row.precipitationSum * (precipitationScale / 100), 1),
    }))
  }, [historical.envelope, temperatureOffset, precipitationScale])

  const powerRows = useMemo(
    () =>
      (power.envelope?.data.days ?? []).map((day) => ({
        date: day.date.slice(5),
        irradiance:
          day.values.ALLSKY_SFC_SW_DWN === null || day.values.ALLSKY_SFC_SW_DWN === undefined
            ? null
            : round(mjPerM2DayToKwhPerM2Day(day.values.ALLSKY_SFC_SW_DWN), 2),
        clearSky:
          day.values.CLRSKY_SFC_SW_DWN === null || day.values.CLRSKY_SFC_SW_DWN === undefined
            ? null
            : round(mjPerM2DayToKwhPerM2Day(day.values.CLRSKY_SFC_SW_DWN), 2),
        temperature: day.values.T2M ?? null,
      })),
    [power.envelope],
  )

  const scenarioActive = temperatureOffset !== 0 || precipitationScale !== 100

  return (
    <ModuleLayout
      main={
        <>
          {/* ── 3D Earth, connected to the selected location ───────────── */}
          <Panel
            eyebrow="Geographic context"
            title="Earth, with the selected location marked"
            description="NASA Blue Marble surface imagery. The marker sits at the selected coordinates and is tinted by the observed 2 m temperature there."
            actions={<DataSourceBadge kind="observation" size="sm" />}
            bodyClassName="pt-0"
          >
            <SceneFrame
              height={400}
              cameraPosition={[0, 0.25, 2.55]}
              overlay={
                current && (
                  <div className="absolute left-4 bottom-4 bg-graphite/70 backdrop-blur-sm rounded-lg px-3.5 py-2.5 max-w-[240px]">
                    <div className="text-[9px] uppercase tracking-widest text-ivory/40 font-medium mb-0.5">
                      Marker
                    </div>
                    <div className="text-[13px] font-semibold text-ivory leading-tight">{location.name}</div>
                    <div className="text-[11px] text-ivory/55 mt-1 tabular-nums">
                      {current.temperature}
                      {units.temperature_2m ?? '°C'} · {current.cloudCover}
                      {units.cloud_cover ?? '%'} cloud
                    </div>
                  </div>
                )
              }
              caption={
                <>
                  The marker's colour maps the observed temperature across −10 °C to 45 °C. Cloud-layer opacity
                  follows the single reported cloud-cover percentage for this location — the cloud texture is a
                  static global image, not a satellite cloud field. Rotation and the atmospheric rim are
                  decorative.
                </>
              }
            >
              <EarthGlobe
                marker={{
                  latitude: location.latitude,
                  longitude: location.longitude,
                  label: location.name,
                  temperatureCelsius: current?.temperature ?? null,
                }}
                cloudCoverPercent={current?.cloudCover ?? null}
                isDay={current?.isDay ?? null}
              />
            </SceneFrame>
          </Panel>

          {/* ── Current conditions ─────────────────────────────────────── */}
          <Panel
            eyebrow="Current conditions"
            title="Observed now at this location"
            description="Values from the Open-Meteo current-conditions block, which is refreshed on a 15-minute interval from national weather service models."
            actions={<DataSourceBadge kind="observation" size="sm" />}
            bodyClassName="pt-0"
          >
            <DataStatus
              result={weather}
              title="current conditions"
              sourceId="open-meteo-forecast"
              skeletonHeight={200}
            >
              {(bundle, meta) =>
                bundle.current ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <MetricCard
                        label="Temperature"
                        value={bundle.current.temperature}
                        unit={bundle.current.units.temperature_2m ?? '°C'}
                        kind="observation"
                        sourceId="open-meteo-forecast"
                        detail="Air temperature at 2 metres"
                        accentColor={sim.color}
                      />
                      <MetricCard
                        label="Feels like"
                        value={bundle.current.apparentTemperature}
                        unit={bundle.current.units.apparent_temperature ?? '°C'}
                        kind="model"
                        sourceId="open-meteo-forecast"
                        detail="Apparent temperature"
                        note="Apparent temperature is computed by the provider from temperature, humidity, wind and radiation — a derived index, not a direct measurement."
                      />
                      <MetricCard
                        label="Relative humidity"
                        value={bundle.current.relativeHumidity}
                        unit={bundle.current.units.relative_humidity_2m ?? '%'}
                        decimals={0}
                        kind="observation"
                        sourceId="open-meteo-forecast"
                        detail="At 2 metres"
                      />
                      <MetricCard
                        label="Wind speed"
                        value={bundle.current.windSpeed}
                        unit={bundle.current.units.wind_speed_10m ?? 'km/h'}
                        kind="observation"
                        sourceId="open-meteo-forecast"
                        detail={
                          bundle.current.windDirection === null
                            ? 'At 10 metres'
                            : `At 10 metres, from ${bundle.current.windDirection}°`
                        }
                      />
                      <MetricCard
                        label="Cloud cover"
                        value={bundle.current.cloudCover}
                        unit={bundle.current.units.cloud_cover ?? '%'}
                        decimals={0}
                        kind="observation"
                        sourceId="open-meteo-forecast"
                        detail="Total column"
                      />
                      <MetricCard
                        label="Surface pressure"
                        value={bundle.current.surfacePressure}
                        unit={bundle.current.units.surface_pressure ?? 'hPa'}
                        kind="observation"
                        sourceId="open-meteo-forecast"
                        detail="At station elevation"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      {describeWeatherCode(bundle.current.weatherCode) && (
                        <span className="text-[13px] text-graphite/70">
                          <span className="text-graphite/40">Conditions: </span>
                          {describeWeatherCode(bundle.current.weatherCode)}
                        </span>
                      )}
                      <LastUpdated
                        observedAt={meta.observedAt}
                        fetchedAt={meta.fetchedAt}
                        stale={meta.stale}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-graphite/50">
                    Open-Meteo returned a forecast for this location but no current-conditions block.
                  </p>
                )
              }
            </DataStatus>
          </Panel>

          {/* ── Forecast ───────────────────────────────────────────────── */}
          <Panel
            eyebrow="Short-range forecast"
            title="Seven-day weather forecast"
            description="A numerical weather forecast from national meteorological models. This is weather, on a scale of days — not a climate projection."
            actions={<DataSourceBadge kind="forecast" size="sm" />}
            bodyClassName="pt-0"
          >
            <DataStatus result={weather} title="the forecast" sourceId="open-meteo-forecast" skeletonHeight={260}>
              {(bundle, meta) => (
                <div className="space-y-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={forecastRows} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                      <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                      <YAxis
                        tick={AXIS_TICK}
                        axisLine={false}
                        tickLine={false}
                        unit={bundle.dailyUnits.temperature_2m_max ?? '°C'}
                        width={56}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={unitFormatter(bundle.dailyUnits.temperature_2m_max ?? '°C', {
                          max: 'Daily maximum',
                          min: 'Daily minimum',
                        })}
                      />
                      <Area
                        type="monotone"
                        dataKey="max"
                        stroke={sim.color}
                        fill={`${sim.color}22`}
                        strokeWidth={2}
                        connectNulls={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="min"
                        stroke={sim.accentColor}
                        fill={`${sim.accentColor}14`}
                        strokeWidth={1.5}
                        connectNulls={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>

                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                      Daily precipitation sum ({bundle.dailyUnits.precipitation_sum ?? 'mm'})
                    </div>
                    <ResponsiveContainer width="100%" height={130}>
                      <BarChart data={forecastRows} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                        <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          formatter={unitFormatter(bundle.dailyUnits.precipitation_sum ?? 'mm', {
                            precipitation: 'Precipitation',
                          })}
                        />
                        <Bar dataKey="precipitation" fill="#8CA8B5" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <LastUpdated
                    observedAt={null}
                    fetchedAt={meta.fetchedAt}
                    stale={meta.stale}
                    label="Forecast retrieved"
                  />
                </div>
              )}
            </DataStatus>
          </Panel>

          {/* ── Historical reanalysis + scenario overlay ──────────────── */}
          <Panel
            eyebrow="Historical record"
            title="Five years of monthly temperature and precipitation"
            description="Monthly means aggregated from daily ERA5 reanalysis. ERA5 is a model-assimilated gridded record rather than a single station's readings, and the archive lags real time by about five days."
            actions={
              <>
                <DataSourceBadge kind="historical" size="sm" />
                {scenarioActive && <DataSourceBadge kind="illustrative" size="sm" />}
              </>
            }
            bodyClassName="pt-0"
          >
            <DataStatus
              result={historical}
              title="the ERA5 reanalysis archive"
              sourceId="open-meteo-archive"
              skeletonHeight={300}
            >
              {(data, meta) => (
                <div className="space-y-5">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={monthlyRows} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                      <XAxis
                        dataKey="month"
                        tick={AXIS_TICK}
                        axisLine={false}
                        tickLine={false}
                        interval={5}
                      />
                      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} unit="°C" width={56} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                        formatter={(value) =>
                          value === 'observedTemperature'
                            ? 'ERA5 monthly mean'
                            : `Scenario (+${temperatureOffset} °C offset)`
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="observedTemperature"
                        stroke={sim.color}
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                      {temperatureOffset !== 0 && (
                        <Line
                          type="monotone"
                          dataKey="scenarioTemperature"
                          stroke="#6E6A60"
                          strokeWidth={1.5}
                          strokeDasharray="5 3"
                          dot={false}
                          connectNulls={false}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>

                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                      Monthly precipitation total (mm)
                    </div>
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={monthlyRows} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                        <XAxis
                          dataKey="month"
                          tick={AXIS_TICK}
                          axisLine={false}
                          tickLine={false}
                          interval={5}
                        />
                        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                        />
                        <Bar dataKey="observedPrecipitation" fill="#8CA8B5" radius={[3, 3, 0, 0]} />
                        {precipitationScale !== 100 && (
                          <Bar dataKey="scenarioPrecipitation" fill="#6E6A6055" radius={[3, 3, 0, 0]} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-graphite/45">
                    <LastUpdated
                      observedAt={null}
                      fetchedAt={meta.fetchedAt}
                      stale={meta.stale}
                      label="Archive retrieved"
                    />
                    <span>
                      Period: {data.bundle.daily[0]?.date} to{' '}
                      {data.bundle.daily[data.bundle.daily.length - 1]?.date} ({data.bundle.daily.length} days)
                    </span>
                  </div>
                </div>
              )}
            </DataStatus>
          </Panel>

          {/* ── NASA POWER solar ──────────────────────────────────────── */}
          <Panel
            eyebrow="Solar & meteorology"
            title="NASA POWER surface solar irradiance"
            description="Satellite-derived, model-assimilated daily irradiance on a roughly 0.5° grid. Values are grid-cell averages, not point measurements, and the daily record lags real time by several days."
            actions={<DataSourceBadge kind="historical" size="sm" />}
            bodyClassName="pt-0"
          >
            <DataStatus result={power} title="NASA POWER daily data" sourceId="nasa-power" skeletonHeight={240}>
              {(bundle, meta) => (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <MetricCard
                      label="Mean irradiance"
                      value={bundle.meanIrradianceKwh}
                      unit="kWh/m²/day"
                      decimals={2}
                      kind="historical"
                      sourceId="nasa-power"
                      detail={`All-sky, over ${bundle.days.length - bundle.missingDayCount} days`}
                      note="Converted from the MJ/m²/day that POWER returns, by dividing by 3.6."
                      accentColor={sim.color}
                    />
                    <MetricCard
                      label="Grid elevation"
                      value={bundle.elevationMetres}
                      unit="m"
                      decimals={0}
                      kind="historical"
                      sourceId="nasa-power"
                      detail="POWER grid-cell elevation"
                    />
                    <MetricCard
                      label="Days with no value"
                      value={bundle.missingDayCount}
                      decimals={0}
                      kind="historical"
                      sourceId="nasa-power"
                      detail="Excluded from the mean above"
                    />
                  </div>

                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={powerRows} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                      <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={9} />
                      <YAxis
                        tick={AXIS_TICK}
                        axisLine={false}
                        tickLine={false}
                        width={56}
                        unit=" kWh"
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={unitFormatter('kWh/m²/day', {
                          irradiance: 'All-sky irradiance',
                          clearSky: 'Clear-sky irradiance',
                        })}
                      />
                      <Area
                        type="monotone"
                        dataKey="clearSky"
                        stroke="#C39A62"
                        fill="#C39A6218"
                        strokeWidth={1.3}
                        strokeDasharray="4 2"
                        connectNulls={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="irradiance"
                        stroke={sim.color}
                        fill={`${sim.color}22`}
                        strokeWidth={2}
                        connectNulls={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                  <p className="text-[11px] text-graphite/45 leading-relaxed">
                    The gap between the clear-sky and all-sky curves is attenuation by cloud and aerosol. Source
                    datasets: {bundle.sources.join(', ') || 'not reported'}.
                  </p>
                  <LastUpdated
                    observedAt={null}
                    fetchedAt={meta.fetchedAt}
                    stale={meta.stale}
                    label="Record retrieved"
                  />
                </div>
              )}
            </DataStatus>
          </Panel>

          {/* ── Source attribution block ─────────────────────────────── */}
          {current && weather.envelope && (
            <SourcePanel
              sourceId="open-meteo-forecast"
              locationLabel={label}
              observedAt={weather.envelope.observedAt}
              fetchedAt={weather.envelope.fetchedAt}
              stale={weather.envelope.stale}
              notes={weather.envelope.notes}
              fields={[
                {
                  parameter: 'Temperature at 2 metres',
                  value: current.temperature === null ? '—' : String(current.temperature),
                  unit: units.temperature_2m ?? '°C',
                  kind: 'observation',
                },
                {
                  parameter: 'Relative humidity at 2 metres',
                  value: current.relativeHumidity === null ? '—' : String(current.relativeHumidity),
                  unit: units.relative_humidity_2m ?? '%',
                  kind: 'observation',
                },
                {
                  parameter: 'Precipitation (current interval)',
                  value: current.precipitation === null ? '—' : String(current.precipitation),
                  unit: units.precipitation ?? 'mm',
                  kind: 'observation',
                },
                {
                  parameter: 'Daily maximum temperature (next 7 days)',
                  value: forecastRows
                    .map((row) => row.max)
                    .filter((v): v is number => v !== null)
                    .join(', '),
                  unit: weather.envelope.data.dailyUnits.temperature_2m_max ?? '°C',
                  kind: 'forecast',
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
              statusFromResult('open-meteo-forecast', weather, {
                detailWhenLive: 'Current conditions and a 7-day forecast.',
              }),
              statusFromResult('open-meteo-archive', historical, {
                detailWhenLive: `${historical.envelope?.data.monthly.length ?? 0} months of ERA5 reanalysis.`,
              }),
              statusFromResult('nasa-power', power, {
                detailWhenLive: `${power.envelope?.data.days.length ?? 0} days of solar and meteorological records.`,
              }),
            ]}
          />

          <Panel
            eyebrow="Scenario controls"
            title="Sensitivity exploration"
            description="Shifts the observed record by a fixed amount so you can see how sensitive the picture is. This is arithmetic on past data, not a forecast."
            bodyClassName="space-y-4"
          >
            <ControlSlider
              label="Temperature offset applied to the ERA5 record"
              value={temperatureOffset}
              min={-3}
              max={5}
              step={0.5}
              unit=" °C"
              accentColor={sim.color}
              onChange={setTemperatureOffset}
              note="A uniform offset. Real warming is not uniform across seasons, latitudes or day and night."
            />
            <ControlSlider
              label="Precipitation scaling applied to the ERA5 record"
              value={precipitationScale}
              min={40}
              max={180}
              step={5}
              unit=" %"
              accentColor={sim.color}
              onChange={setPrecipitationScale}
              note="A uniform multiplier. Real precipitation change alters intensity distribution, not just totals."
            />
            <button
              onClick={() => {
                setTemperatureOffset(0)
                setPrecipitationScale(100)
              }}
              className="text-[11px] text-graphite/50 hover:text-graphite underline"
            >
              Reset to observed values
            </button>
            <ScenarioNotice>
              These controls apply an arithmetic offset to the observed record. They are not fitted to any climate
              model and make no prediction about this location's future.
            </ScenarioNotice>
          </Panel>

          <SceneLegend>
            <LegendRow
              swatch="#C25E3A"
              label="Marker colour"
              meaning="observed 2 m temperature, mapped −10 °C to 45 °C"
              derived
            />
            <LegendRow
              swatch="#E8E4DA"
              label="Cloud layer opacity"
              meaning="observed total cloud cover at the marker, 0–100 %"
              derived
            />
            <LegendRow
              swatch="#FFF6E8"
              label="Key light"
              meaning="dimmed when the provider reports night at the marker"
              derived
            />
            <LegendRow swatch="#8CA8B5" label="Atmospheric rim" meaning="visual depth cue" derived={false} />
            <LegendRow swatch="#4A5560" label="Globe rotation" meaning="fixed slow spin" derived={false} />
          </SceneLegend>

          {/* ── Honest statement about climate projection ─────────────── */}
          <div className="bg-white border border-graphite/10 rounded-xl p-5">
            <div className="flex items-start gap-2.5 mb-3">
              <Info size={13} className="text-graphite/40 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-1">
                  Not integrated
                </div>
                <h4 className="text-[13px] font-semibold text-graphite">Long-term climate projection</h4>
              </div>
            </div>
            <p className="text-[12px] text-graphite/55 leading-relaxed mb-3">
              {cmip6Readiness.whatTheUiDoesInstead}
            </p>
            <div className="text-[11px] text-graphite/45 leading-relaxed space-y-1.5">
              <div>
                <span className="font-medium text-graphite/60">Candidate dataset: </span>
                <a
                  href={cmip6Readiness.datasetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sage hover:underline inline-flex items-center gap-0.5"
                >
                  {cmip6Readiness.candidateDataset} <ExternalLink size={9} />
                </a>
                <span className="text-graphite/40"> · {cmip6Readiness.resolution}</span>
              </div>
              <ul className="space-y-1 pt-1">
                {cmip6Readiness.blockers.map((blocker) => (
                  <li key={blocker} className="flex gap-1.5">
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
