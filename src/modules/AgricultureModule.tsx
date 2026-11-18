import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ExternalLink, Sprout } from 'lucide-react'
import { AXIS_TICK, CHART_GRID_STROKE, TOOLTIP_STYLE, unitFormatter } from '../components/data/chartFormat'
import DataSourceBadge from '../components/data/DataSourceBadge'
import DataSourceStatus, { statusFromResult } from '../components/data/DataSourceStatus'
import DataStatus from '../components/data/DataStatus'
import LastUpdated from '../components/data/LastUpdated'
import MetricCard from '../components/data/MetricCard'
import Panel from '../components/data/Panel'
import SourcePanel from '../components/data/SourcePanel'
import SceneFrame from '../three/SceneFrame'
import FarmScene from '../three/scenes/FarmScene'
import { useSelectedLocation } from '../context/LocationContext'
import { usePowerDaily, useWeather } from '../services/hooks/useClimateData'
import {
  CROP_COEFFICIENTS,
  DEFAULT_IRRIGATION_INPUTS,
  FAO56,
  IRRIGATION_ASSUMPTIONS,
  soilMoistureBand,
  useIrrigationEstimate,
  type IrrigationInputs,
} from '../services/hooks/useAgriData'
import { mjPerM2DayToKwhPerM2Day, round } from '../services/data/normalizers/units'
import { ControlSlider, LegendRow, ModuleLayout, SceneLegend, type ModuleProps } from './shared'

export default function AgricultureModule({ sim }: ModuleProps) {
  const { location, label } = useSelectedLocation()
  const weather = useWeather(location, { forecastDays: 7, pastDays: 7, includeSoilMoisture: true })
  const power = usePowerDaily(location, 60)

  const [inputs, setInputs] = useState<IrrigationInputs>(DEFAULT_IRRIGATION_INPUTS)
  const [crop, setCrop] = useState(CROP_COEFFICIENTS[1].crop)

  const irrigation = useIrrigationEstimate(weather.envelope?.data ?? null, inputs)

  const current = weather.envelope?.data.current ?? null
  const today = new Date().toISOString().slice(0, 10)

  /** Most recent soil-moisture value in the hourly series at or before now. */
  const soilMoisture = useMemo(() => {
    const hourly = weather.envelope?.data.hourly ?? []
    const nowIso = new Date().toISOString().slice(0, 13)
    const withValue = hourly.filter((hour) => hour.soilMoisture0to7cm !== null)
    if (withValue.length === 0) return null
    const past = withValue.filter((hour) => hour.time.slice(0, 13) <= nowIso)
    const chosen = past.length > 0 ? past[past.length - 1] : withValue[0]
    return {
      value: chosen.soilMoisture0to7cm!,
      time: chosen.time,
      // The hourly series straddles now, so say which side this value is on.
      isForecast: chosen.time.slice(0, 13) > nowIso,
    }
  }, [weather.envelope])

  const band = soilMoistureBand(soilMoisture?.value ?? null)

  const soilRows = useMemo(
    () =>
      (weather.envelope?.data.hourly ?? [])
        .filter((hour) => hour.soilMoisture0to7cm !== null)
        .map((hour) => ({
          time: hour.time.slice(5, 13).replace('T', ' '),
          moisture: round(hour.soilMoisture0to7cm!, 3),
          precipitation: hour.precipitation,
        })),
    [weather.envelope],
  )

  const irrigationRows = useMemo(
    () =>
      (irrigation?.days ?? []).map((day) => ({
        date: day.date.slice(5),
        demand: day.cropWaterDemand === null ? null : round(day.cropWaterDemand, 2),
        effectiveRain: day.effectiveRainfall === null ? null : round(day.effectiveRainfall, 2),
        gross: day.grossIrrigation === null ? null : round(day.grossIrrigation, 2),
      })),
    [irrigation],
  )

  const solarRows = useMemo(
    () =>
      (power.envelope?.data.days ?? []).map((day) => ({
        date: day.date.slice(5),
        irradiance:
          day.values.ALLSKY_SFC_SW_DWN === null || day.values.ALLSKY_SFC_SW_DWN === undefined
            ? null
            : round(mjPerM2DayToKwhPerM2Day(day.values.ALLSKY_SFC_SW_DWN), 2),
      })),
    [power.envelope],
  )

  const currentRainfallMmPerHour =
    current?.precipitation === null || current?.precipitation === undefined ? null : current.precipitation * 4

  /** Today's forecast irradiance from Open-Meteo, for the scene lighting. */
  const todayIrradianceKwh = useMemo(() => {
    const todayRow = (weather.envelope?.data.daily ?? []).find((day) => day.date === today)
    if (!todayRow || todayRow.shortwaveRadiationSum === null) return power.envelope?.data.meanIrradianceKwh ?? null
    // Open-Meteo reports shortwave_radiation_sum in MJ/m².
    return mjPerM2DayToKwhPerM2Day(todayRow.shortwaveRadiationSum)
  }, [weather.envelope, power.envelope, today])

  return (
    <ModuleLayout
      main={
        <>
          {/* ── 3D farm, driven by measured conditions ─────────────── */}
          <Panel
            eyebrow="Field visualisation"
            title="Farm scene driven by observed conditions"
            description="Soil colour, light and rain each follow a specific measured or forecast variable for the selected coordinates."
            actions={<DataSourceBadge kind="observation" size="sm" />}
            bodyClassName="pt-0"
          >
            <SceneFrame
              height={400}
              cameraPosition={[0, 1.1, 2.5]}
              background="#1B1F18"
              overlay={
                <div className="absolute left-4 bottom-4 bg-graphite/70 backdrop-blur-sm rounded-lg px-3.5 py-2.5">
                  <div className="text-[9px] uppercase tracking-widest text-ivory/40 font-medium mb-1">
                    Driving values
                  </div>
                  <div className="text-[11px] text-ivory/70 leading-relaxed tabular-nums">
                    Soil moisture{' '}
                    {soilMoisture === null ? '—' : `${round(soilMoisture.value, 3)} m³/m³`}
                    <br />
                    Irradiance {todayIrradianceKwh === null ? '—' : `${round(todayIrradianceKwh, 2)} kWh/m²/d`}
                    <br />
                    Wind {current?.windSpeed === null || current === null ? '—' : `${current.windSpeed} km/h`}
                  </div>
                </div>
              }
              caption={
                <>
                  Soil colour maps volumetric moisture in the 0–7 cm layer across 0.05–0.40 m³/m³ — pale and warm
                  when dry, dark when wet. Key-light intensity scales with daily irradiance against a 7 kWh/m²/day
                  ceiling. Canopy sway scales with wind speed, and rain particles with the current rainfall rate.
                  Crop height, spacing and colour are <strong>fixed</strong>: no source tells us what is planted
                  here or how it is growing, so nothing in this scene indicates crop condition or yield.
                </>
              }
            >
              <FarmScene
                soilMoistureFraction={soilMoisture?.value ?? null}
                irradianceKwhPerM2Day={todayIrradianceKwh}
                rainfallMmPerHour={currentRainfallMmPerHour}
                windSpeedKmh={current?.windSpeed ?? null}
                isDay={current?.isDay ?? null}
              />
            </SceneFrame>
          </Panel>

          {/* ── Soil moisture ─────────────────────────────────────── */}
          <Panel
            eyebrow="Soil"
            title="Volumetric soil moisture, 0–7 cm layer"
            description="Water content as a fraction of soil volume, from the Open-Meteo land-surface model. It is a modelled layer value, not a probe reading."
            actions={<DataSourceBadge kind={soilMoisture?.isForecast ? 'forecast' : 'observation'} size="sm" />}
            bodyClassName="pt-0"
          >
            <DataStatus result={weather} title="soil moisture" sourceId="open-meteo-forecast" skeletonHeight={220}>
              {(bundle, meta) =>
                soilMoisture === null ? (
                  <p className="text-[12px] text-graphite/55 leading-relaxed">
                    Open-Meteo returned no soil-moisture values for this location. The variable is not available on
                    every model domain, and nothing is substituted in its place.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <MetricCard
                        label="Soil moisture"
                        value={round(soilMoisture.value, 3)}
                        unit={bundle.hourlyUnits.soil_moisture_0_to_7cm ?? 'm³/m³'}
                        decimals={3}
                        kind={soilMoisture.isForecast ? 'forecast' : 'observation'}
                        sourceId="open-meteo-forecast"
                        detail={band ? band.label : undefined}
                        note="Volumetric water content: cubic metres of water per cubic metre of soil. Interpreting it as 'percent of available water' would need this soil's own field capacity and wilting point, which we do not have for an arbitrary point."
                        accentColor={sim.color}
                      />
                      <MetricCard
                        label="Relative humidity"
                        value={current?.relativeHumidity ?? null}
                        unit="%"
                        decimals={0}
                        kind="observation"
                        sourceId="open-meteo-forecast"
                        detail="At 2 metres"
                      />
                      <MetricCard
                        label="Reference ET₀ today"
                        value={
                          bundle.daily.find((day) => day.date === today)?.et0 === null ||
                          bundle.daily.find((day) => day.date === today)?.et0 === undefined
                            ? null
                            : round(bundle.daily.find((day) => day.date === today)!.et0!, 2)
                        }
                        unit={bundle.dailyUnits.et0_fao_evapotranspiration ?? 'mm'}
                        decimals={2}
                        kind="forecast"
                        sourceId="open-meteo-forecast"
                        detail="FAO-56 Penman-Monteith"
                        note="Reference evapotranspiration for a short grass reference surface, computed by the provider. Crop demand is this value times a crop coefficient."
                      />
                    </div>

                    {band && (
                      <p className="text-[11px] text-graphite/50 leading-relaxed">
                        <strong className="text-graphite/70">{band.label}:</strong> {band.note} These bands are
                        generic soil-physics reference ranges, not calibrated to this field's texture.
                      </p>
                    )}

                    {soilRows.length > 4 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-2">
                          Hourly soil moisture (m³/m³)
                        </div>
                        <ResponsiveContainer width="100%" height={160}>
                          <LineChart data={soilRows} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                            <XAxis dataKey="time" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={23} />
                            <YAxis
                              tick={AXIS_TICK}
                              axisLine={false}
                              tickLine={false}
                              width={56}
                              domain={['dataMin - 0.02', 'dataMax + 0.02']}
                            />
                            <Tooltip
                              contentStyle={TOOLTIP_STYLE}
                              formatter={unitFormatter('m³/m³', { moisture: 'Soil moisture' })}
                            />
                            <Line
                              type="monotone"
                              dataKey="moisture"
                              stroke={sim.color}
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    <LastUpdated
                      observedAt={soilMoisture.time}
                      fetchedAt={meta.fetchedAt}
                      stale={meta.stale}
                      label={soilMoisture.isForecast ? 'Model hour (forecast)' : 'Model hour'}
                    />
                  </div>
                )
              }
            </DataStatus>
          </Panel>

          {/* ── Irrigation water balance ─────────────────────────── */}
          <Panel
            eyebrow="Water balance"
            title="FAO-56 irrigation requirement"
            description="Net irrigation = Kc × ET₀ − effective rainfall, summed over the forecast period. A water-balance calculation, not a yield model."
            actions={<DataSourceBadge kind="model" size="sm" />}
            bodyClassName="pt-0"
          >
            {irrigation?.totals ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MetricCard
                    label="Crop water demand"
                    value={round(irrigation.totals.cropWaterDemandMm, 1)}
                    unit="mm"
                    kind="model"
                    sourceId="terraverse-model"
                    detail={`Kc ${inputs.kc} × ET₀ over ${irrigation.totals.dayCount} days`}
                    note="Kc × ET₀, where ET₀ is the provider's FAO-56 reference evapotranspiration."
                    accentColor={sim.color}
                  />
                  <MetricCard
                    label="Effective rainfall"
                    value={round(irrigation.totals.effectiveRainfallMm, 1)}
                    unit="mm"
                    kind="model"
                    sourceId="terraverse-model"
                    detail={`${round(inputs.effectiveRainfallFraction * 100, 0)}% of forecast rainfall`}
                    note="The fraction of rainfall assumed to reach the root zone rather than running off or evaporating. A planning assumption you set, not a measurement."
                  />
                  <MetricCard
                    label="Net irrigation"
                    value={round(irrigation.totals.netIrrigationMm, 1)}
                    unit="mm"
                    kind="model"
                    sourceId="terraverse-model"
                    detail="Demand minus effective rainfall"
                    note="Floored at zero each day. A daily surplus does not carry forward, because soil water storage is not modelled."
                  />
                  <MetricCard
                    label="Gross irrigation"
                    value={round(irrigation.totals.grossIrrigationMm, 1)}
                    unit="mm"
                    kind="model"
                    sourceId="terraverse-model"
                    detail={`At ${round(inputs.applicationEfficiency * 100, 0)}% application efficiency`}
                    note={`Equivalent to ${Math.round(irrigation.totals.grossLitresPerHectare).toLocaleString()} litres per hectare over the period (1 mm over 1 ha = 10 000 L).`}
                    accentColor={sim.color}
                  />
                </div>

                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={irrigationRows} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                    <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} unit=" mm" />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={unitFormatter('mm', {
                        demand: 'Crop water demand',
                        effectiveRain: 'Effective rainfall',
                        gross: 'Gross irrigation needed',
                      })}
                    />
                    <Bar dataKey="demand" fill="#C39A62" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="effectiveRain" fill="#8CA8B5" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="gross" fill={sim.color} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-graphite/55">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#C39A62]" /> Crop demand (Kc × ET₀)
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#8CA8B5]" /> Effective rainfall
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: sim.color }} /> Gross
                    irrigation
                  </span>
                </div>

                {irrigation.missingDays > 0 && (
                  <p className="text-[11px] text-graphite/45">
                    {irrigation.missingDays} day(s) have no ET₀ value from the provider and are excluded from the
                    totals above.
                  </p>
                )}

                <div className="bg-graphite/[0.03] border border-graphite/10 rounded-lg p-4">
                  <div className="text-[10px] uppercase tracking-widest text-graphite/40 font-medium mb-2">
                    Assumptions this estimate rests on
                  </div>
                  <ul className="space-y-1.5">
                    {IRRIGATION_ASSUMPTIONS.map((assumption) => (
                      <li key={assumption} className="text-[11px] text-graphite/55 leading-relaxed flex gap-1.5">
                        <span className="text-graphite/25 shrink-0">·</span>
                        <span>{assumption}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href={FAO56.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-sage hover:underline inline-flex items-center gap-1 mt-2.5"
                  >
                    {FAO56.citation} <ExternalLink size={9} />
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-graphite/55 leading-relaxed">
                The irrigation balance needs reference evapotranspiration, which the provider did not return for
                this location. No estimate is shown rather than one built on a substituted ET₀.
              </p>
            )}
          </Panel>

          {/* ── Solar radiation ───────────────────────────────────── */}
          <Panel
            eyebrow="Solar radiation"
            title="NASA POWER surface irradiance"
            description="Daily all-sky shortwave irradiance on NASA POWER's satellite-derived grid, over the last 60 days available."
            actions={<DataSourceBadge kind="historical" size="sm" />}
            bodyClassName="pt-0"
          >
            <DataStatus result={power} title="NASA POWER irradiance" sourceId="nasa-power" skeletonHeight={220}>
              {(bundle, meta) => (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <MetricCard
                      label="Mean daily irradiance"
                      value={bundle.meanIrradianceKwh === null ? null : round(bundle.meanIrradianceKwh, 2)}
                      unit="kWh/m²/day"
                      decimals={2}
                      kind="historical"
                      sourceId="nasa-power"
                      detail={`Over ${bundle.days.length - bundle.missingDayCount} days`}
                      accentColor={sim.color}
                    />
                    <MetricCard
                      label="Mean air temperature"
                      value={(() => {
                        const values = bundle.days
                          .map((day) => day.values.T2M)
                          .filter((v): v is number => v !== null && v !== undefined)
                        return values.length === 0
                          ? null
                          : round(values.reduce((a, b) => a + b, 0) / values.length, 1)
                      })()}
                      unit={bundle.units.T2M ?? '°C'}
                      kind="historical"
                      sourceId="nasa-power"
                      detail="POWER grid-cell mean"
                    />
                    <MetricCard
                      label="Total precipitation"
                      value={(() => {
                        const values = bundle.days
                          .map((day) => day.values.PRECTOTCORR)
                          .filter((v): v is number => v !== null && v !== undefined)
                        return values.length === 0 ? null : round(values.reduce((a, b) => a + b, 0), 1)
                      })()}
                      unit="mm"
                      kind="historical"
                      sourceId="nasa-power"
                      detail="Bias-corrected, over the period"
                    />
                  </div>

                  <ResponsiveContainer width="100%" height={170}>
                    <AreaChart data={solarRows} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                      <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={6} />
                      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={58} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={unitFormatter('kWh/m²/day', { irradiance: 'All-sky irradiance' })}
                      />
                      <Area
                        type="monotone"
                        dataKey="irradiance"
                        stroke="#C39A62"
                        fill="#C39A6225"
                        strokeWidth={2}
                        connectNulls={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>

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

          {weather.envelope?.data.current && (
            <SourcePanel
              sourceId="open-meteo-forecast"
              locationLabel={label}
              observedAt={weather.envelope.observedAt}
              fetchedAt={weather.envelope.fetchedAt}
              stale={weather.envelope.stale}
              fields={[
                {
                  parameter: 'Soil water content, 0–7 cm layer',
                  value: soilMoisture === null ? '—' : String(round(soilMoisture.value, 3)),
                  unit: weather.envelope.data.hourlyUnits.soil_moisture_0_to_7cm ?? 'm³/m³',
                  kind: soilMoisture?.isForecast ? 'forecast' : 'observation',
                },
                {
                  parameter: 'Reference evapotranspiration (FAO-56)',
                  value: (() => {
                    const value = weather.envelope!.data.daily.find((day) => day.date === today)?.et0
                    return value === null || value === undefined ? '—' : String(round(value, 2))
                  })(),
                  unit: weather.envelope.data.dailyUnits.et0_fao_evapotranspiration ?? 'mm',
                  kind: 'forecast',
                },
                {
                  parameter: `Gross irrigation requirement (${crop})`,
                  value: irrigation?.totals ? String(round(irrigation.totals.grossIrrigationMm, 1)) : '—',
                  unit: 'mm',
                  kind: 'model',
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
                detailWhenLive: 'Soil moisture, ET₀, precipitation and wind.',
              }),
              statusFromResult('nasa-power', power, {
                detailWhenLive: `${power.envelope?.data.days.length ?? 0} days of solar and meteorological records.`,
              }),
            ]}
          />

          <Panel
            eyebrow="Irrigation inputs"
            title="Crop and system assumptions"
            description="Every value here is yours to set. The calculation is only as good as these inputs, and they are shown alongside the result for that reason."
            bodyClassName="space-y-4"
          >
            <div>
              <label className="block text-[11px] font-medium text-graphite/55 mb-1.5">Crop</label>
              <select
                value={crop}
                onChange={(event) => {
                  const selected = CROP_COEFFICIENTS.find((entry) => entry.crop === event.target.value)
                  setCrop(event.target.value)
                  if (selected) setInputs((previous) => ({ ...previous, kc: selected.kcMid }))
                }}
                className="w-full px-3 py-2 text-[12px] rounded-lg border border-graphite/15 bg-white text-graphite focus:outline-none focus:border-sage/50"
              >
                {CROP_COEFFICIENTS.map((entry) => (
                  <option key={entry.crop} value={entry.crop}>
                    {entry.crop} — Kc {entry.kcMid}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-graphite/40 leading-snug mt-1.5">
                {CROP_COEFFICIENTS.find((entry) => entry.crop === crop)?.note}
              </p>
            </div>

            <ControlSlider
              label="Crop coefficient Kc"
              value={inputs.kc}
              min={0.3}
              max={1.4}
              step={0.05}
              accentColor={sim.color}
              onChange={(value) => setInputs((previous) => ({ ...previous, kc: value }))}
              note="FAO-56 mid-season values are selected by crop above. Early and late growth stages need lower values."
            />
            <ControlSlider
              label="Effective rainfall fraction"
              value={inputs.effectiveRainfallFraction}
              min={0.3}
              max={1}
              step={0.05}
              format={(value) => `${Math.round(value * 100)}`}
              unit="%"
              accentColor={sim.color}
              onChange={(value) =>
                setInputs((previous) => ({ ...previous, effectiveRainfallFraction: value }))
              }
              note="Share of rainfall reaching the root zone. Depends on soil, slope and rainfall intensity."
            />
            <ControlSlider
              label="Application efficiency"
              value={inputs.applicationEfficiency}
              min={0.4}
              max={0.95}
              step={0.05}
              format={(value) => `${Math.round(value * 100)}`}
              unit="%"
              accentColor={sim.color}
              onChange={(value) => setInputs((previous) => ({ ...previous, applicationEfficiency: value }))}
              note="Surface irrigation is typically 0.6–0.8; well-managed drip reaches about 0.9."
            />
            <button
              onClick={() => setInputs(DEFAULT_IRRIGATION_INPUTS)}
              className="text-[11px] text-graphite/50 hover:text-graphite underline"
            >
              Reset to defaults
            </button>
          </Panel>

          <SceneLegend>
            <LegendRow
              swatch="#3A3026"
              label="Soil colour"
              meaning="volumetric moisture, 0–7 cm, mapped 0.05–0.40 m³/m³"
              derived
            />
            <LegendRow
              swatch="#FFF0CE"
              label="Key light"
              meaning="daily solar irradiance against a 7 kWh/m²/day ceiling"
              derived
            />
            <LegendRow
              swatch="#C7E4F2"
              label="Rain particles"
              meaning="current rainfall rate from the provider"
              derived
            />
            <LegendRow
              swatch="#6E8F3A"
              label="Canopy sway"
              meaning="observed wind speed at 10 metres"
              derived
            />
            <LegendRow
              swatch="#6E8F3A"
              label="Crop height & spacing"
              meaning="fixed uniform stand"
              derived={false}
            />
          </SceneLegend>

          <div className="bg-white border border-graphite/10 rounded-xl p-5">
            <div className="flex items-start gap-2 mb-2">
              <Sprout size={13} className="text-graphite/40 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-1">
                  Not claimed
                </div>
                <h4 className="text-[13px] font-semibold text-graphite">Crop yield</h4>
              </div>
            </div>
            <p className="text-[12px] text-graphite/55 leading-relaxed">
              {sim.doesNotClaim} A credible yield estimate needs a calibrated crop growth model, the actual
              cultivar and sowing date, soil profile data, and nutrient and pest status — none of which any
              integrated source here provides. The irrigation figure above is a water balance and says nothing
              about what the field will produce.
            </p>
          </div>
        </>
      }
    />
  )
}
