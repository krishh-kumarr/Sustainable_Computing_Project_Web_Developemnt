/**
 * Urban energy and emissions engine.
 *
 * A transparent accounting model of a city's electricity and transport energy,
 * with two feedback terms that make the levers interact rather than simply
 * adding up:
 *
 *  1. **Urban heat island.** Green cover moderates summer temperatures, which
 *     changes cooling demand, which changes electricity, which changes
 *     emissions. Planting trees therefore shows up in the energy line, not
 *     only in a sequestration line.
 *  2. **Congestion.** Vehicle energy per kilometre rises as traffic density
 *     rises, because stop-start driving is less efficient than free flow. So
 *     shifting trips to public transport saves more than its share of
 *     kilometres would suggest.
 *
 * Building footprint and green-space area come from real OpenStreetMap
 * geometry for the selected location where it loaded; the per-capita
 * intensities are published averages, cited below. Everything else is an
 * assumption the user sets.
 */

import type {
  EngineBaseline,
  MetricDefinition,
  ScenarioPreset,
  SeriesKey,
  SeriesRow,
  SimulationEngine,
} from '../types/engine.ts'
import type { ParameterSpec } from '../types/parameters.ts'

export interface CityBaseline extends EngineBaseline {
  /** Mapped building footprints in the query box. */
  mappedBuildingCount: number | null
  /** Mapped green cover as a share of the query box, %. */
  mappedGreenCoverPercent: number | null
  /** Mapped major-road length, km. */
  mappedRoadKm: number | null
  /** Ground area of the query box, km². */
  queryAreaKm2: number | null
  /** Observed air temperature, °C. */
  observedTemperatureC: number | null
  /** Measured EPA air-quality index at the nearest station. */
  observedAqi: number | null
  locationLabel: string
}

export const EMPTY_CITY_BASELINE: CityBaseline = {
  mappedBuildingCount: null,
  mappedGreenCoverPercent: null,
  mappedRoadKm: null,
  queryAreaKm2: null,
  observedTemperatureC: null,
  observedAqi: null,
  locationLabel: 'No location',
  provenance: ['No OpenStreetMap or air-quality data loaded yet.'],
  seededFromObservation: false,
}

/**
 * Published intensity figures. Each is an average across very different
 * cities, and a specific city can differ by a factor of two or more.
 */
export const INTENSITIES = {
  /**
   * Residential + commercial electricity per person per year, kWh.
   * Roughly the global urban average implied by IEA electricity demand
   * divided by urban population. Varies enormously with climate and income.
   */
  buildingElectricityKwhPerCapitaYear: 2600,
  /** Share of building electricity that is space cooling, and so climate-sensitive. */
  coolingShareOfBuildingElectricity: 0.18,
  /** Passenger-kilometres travelled per person per day in a large city. */
  passengerKmPerCapitaDay: 24,
  /** Internal-combustion car energy at free flow, kWh of fuel per vehicle-km. */
  iceEnergyKwhPerKm: 0.62,
  /** Battery-electric car energy at free flow, kWh per vehicle-km. */
  evEnergyKwhPerKm: 0.19,
  /** Public transport energy per passenger-km, kWh. Mostly electric rail. */
  transitEnergyKwhPerPassengerKm: 0.11,
  /** Mean car occupancy, passengers per vehicle. */
  carOccupancy: 1.4,
  /** Combustion emissions of liquid fuel, gCO₂e per kWh of fuel energy. */
  fuelEmissionsGPerKwh: 250,
  /**
   * Net CO₂ sequestration by established urban vegetation, tonnes per hectare
   * per year. Published urban-forest studies span roughly 2–8; 5 is used.
   */
  sequestrationTonnesPerHectareYear: 5,
} as const

/**
 * Urban heat island mitigation by green cover.
 *
 * Published urban-greening studies find roughly 0.1–0.5 °C of peak summer
 * cooling per 10 percentage points of canopy cover. 0.03 °C per percentage
 * point sits in that range. Strongly dependent on climate, irrigation and
 * canopy structure.
 */
export const UHI_COOLING_PER_GREEN_PERCENT = 0.03

/**
 * Cooling electricity sensitivity to temperature: about 4 % more cooling
 * demand per kelvin, from published degree-day elasticity studies.
 */
export const COOLING_SENSITIVITY_PER_K = 0.04

/**
 * Congestion penalty on vehicle energy. At full congestion, stop-start
 * driving raises energy per kilometre by 45 % over free flow — consistent
 * with published drive-cycle comparisons between urban and highway cycles.
 */
export const CONGESTION_ENERGY_PENALTY = 0.45

export interface CityState {
  day: number
  cumulative: {
    buildingElectricityMwh: number
    transportElectricityMwh: number
    transportFuelMwh: number
    emissionsTonnes: number
    sequestrationTonnes: number
  }
  /** Values for the most recent day, for the live readout. */
  daily: {
    buildingElectricityMwh: number
    transportElectricityMwh: number
    transportFuelMwh: number
    emissionsTonnes: number
    effectiveTemperatureC: number
    congestionFactor: number
  }
}

const PARAMETERS: ParameterSpec[] = [
  {
    key: 'populationThousands',
    label: 'Population served',
    unit: 'thousand',
    min: 10,
    max: 20000,
    step: 10,
    default: 850,
    decimals: 0,
    group: 'City',
    note: 'People in the modelled area. Scales both building and transport demand linearly.',
  },
  {
    key: 'trafficDensityPercent',
    label: 'Traffic density',
    unit: '% of saturation',
    min: 0,
    max: 100,
    step: 1,
    default: 60,
    decimals: 0,
    group: 'Transport',
    note: 'How congested the network is relative to saturation. Raises energy per vehicle-kilometre by up to 45 % through stop-start driving. This is a scenario input — no traffic data provider is integrated, and nothing here observes or predicts real traffic.',
  },
  {
    key: 'publicTransportPercent',
    label: 'Public transport mode share',
    unit: '%',
    min: 0,
    max: 90,
    step: 1,
    default: 25,
    decimals: 0,
    group: 'Transport',
    note: 'Share of passenger-kilometres carried by transit rather than cars. Transit is both more efficient per passenger-km and reduces the congestion that penalises the remaining cars.',
  },
  {
    key: 'evSharePercent',
    label: 'Electric vehicle share',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    default: 12,
    decimals: 0,
    group: 'Transport',
    note: 'Share of car travel by battery-electric vehicles. Moves energy from liquid fuel to the grid, so its emissions benefit depends entirely on grid carbon intensity.',
  },
  {
    key: 'buildingEfficiencyPercent',
    label: 'Building efficiency improvement',
    unit: '%',
    min: 0,
    max: 60,
    step: 1,
    default: 0,
    decimals: 0,
    group: 'Buildings',
    note: 'Reduction in building electricity from insulation, glazing, controls and appliance standards, relative to the current stock.',
  },
  {
    key: 'greenCoverPercent',
    label: 'Green cover',
    unit: '%',
    min: 0,
    max: 60,
    step: 1,
    default: 12,
    decimals: 0,
    group: 'Land',
    seededFromObservation: true,
    note: 'Seeded from the OpenStreetMap mapped green cover for this location, which under-counts street trees and private gardens. Moderates the heat island and sequesters carbon.',
  },
  {
    key: 'renewableSharePercent',
    label: 'Renewable supply share',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
    default: 30,
    decimals: 0,
    group: 'Supply',
    sharedKey: 'renewableSharePercent',
    note: 'Share of electricity treated as zero-carbon at the point of use. Shared with the Green Data Centre, on the same accounting basis.',
  },
  {
    key: 'gridCarbonIntensity',
    label: 'Grid carbon intensity',
    unit: 'gCO₂e/kWh',
    min: 10,
    max: 900,
    step: 5,
    default: 450,
    decimals: 0,
    group: 'Supply',
    sharedKey: 'gridCarbonIntensity',
    note: 'Carbon intensity of the non-renewable share. Shared with the Green Data Centre.',
  },
  {
    key: 'temperatureAnomalyK',
    label: 'Temperature anomaly',
    unit: 'K',
    min: -2,
    max: 6,
    step: 0.1,
    default: 0,
    decimals: 1,
    group: 'Climate',
    sharedKey: 'temperatureAnomalyK',
    note: 'Added to the observed temperature, raising cooling demand by about 4 % per kelvin. Shared with Climate, Forest, AquaGuard and AgriFuture.',
  },
]

const METRICS: MetricDefinition[] = [
  { key: 'annualElectricityGwh', label: 'Annual electricity demand', unit: 'GWh/yr', kind: 'model', decimals: 1, headline: true, lowerIsBetter: true },
  { key: 'annualEmissionsKt', label: 'Annual emissions', unit: 'ktCO₂e/yr', kind: 'model', decimals: 2, headline: true, lowerIsBetter: true },
  { key: 'perCapitaEmissionsKg', label: 'Emissions per person', unit: 'kgCO₂e/yr', kind: 'model', decimals: 0, headline: true, lowerIsBetter: true },
  { key: 'netEmissionsKt', label: 'Net of sequestration', unit: 'ktCO₂e/yr', kind: 'model', decimals: 2, headline: true, lowerIsBetter: true, note: 'Emissions minus the carbon taken up by urban vegetation. Sequestration is small relative to a city\'s emissions — the figure is here to show that, not to suggest offsetting works at this scale.' },
  { key: 'buildingElectricityGwh', label: 'Building electricity', unit: 'GWh/yr', kind: 'model', decimals: 1, lowerIsBetter: true },
  { key: 'transportElectricityGwh', label: 'Transport electricity', unit: 'GWh/yr', kind: 'model', decimals: 2, lowerIsBetter: true },
  { key: 'transportFuelGwh', label: 'Transport liquid fuel', unit: 'GWh/yr', kind: 'model', decimals: 1, lowerIsBetter: true },
  { key: 'sequestrationTonnes', label: 'Vegetation sequestration', unit: 'tCO₂e/yr', kind: 'model', decimals: 0 },
  { key: 'effectiveTemperatureC', label: 'Effective urban temperature', unit: '°C', kind: 'model', decimals: 2, lowerIsBetter: true, note: 'Observed temperature plus the anomaly, less the heat-island moderation from green cover.' },
  { key: 'heatIslandOffsetC', label: 'Heat-island moderation', unit: 'K', kind: 'model', decimals: 2, note: 'Cooling attributed to green cover at 0.03 K per percentage point, within the range published urban-greening studies report.' },
  { key: 'congestionFactor', label: 'Congestion energy penalty', unit: '×', kind: 'model', decimals: 3, lowerIsBetter: true },
  { key: 'greenAreaHectares', label: 'Green area', unit: 'ha', kind: 'model', decimals: 1 },
  { key: 'mappedBuildingCount', label: 'Mapped buildings', unit: 'buildings', kind: 'observation', decimals: 0, sourceId: 'openstreetmap', note: 'Real OpenStreetMap footprints in the query box. Volunteer-mapped, so a lower bound.' },
  { key: 'mappedGreenCoverPercent', label: 'Mapped green cover', unit: '%', kind: 'observation', decimals: 2, sourceId: 'openstreetmap' },
  { key: 'observedAqi', label: 'Measured air quality index', unit: 'AQI', kind: 'observation', decimals: 0, sourceId: 'openaq', note: 'US EPA index computed from the nearest station\'s measured concentrations. Not affected by this model, which has no dispersion component.' },
]

const SERIES: SeriesKey[] = [
  { key: 'electricity', label: 'Cumulative electricity', unit: 'MWh', colour: '#8B5CF6' },
  { key: 'emissions', label: 'Cumulative emissions', unit: 'tCO₂e', colour: '#C25E3A' },
  { key: 'dailyElectricity', label: 'Daily electricity', unit: 'MWh/day', colour: '#C4B5FD', secondaryAxis: true },
  { key: 'temperature', label: 'Effective temperature', unit: '°C', colour: '#C39A62', secondaryAxis: true },
  { key: 'sequestration', label: 'Cumulative sequestration', unit: 'tCO₂e', colour: '#64816C' },
]

const PRESETS: ScenarioPreset[] = [
  {
    id: 'conventional',
    label: 'Conventional city',
    kind: 'baseline',
    description: 'Car-dominated, little green cover, mostly fossil electricity and no efficiency programme.',
    overrides: { trafficDensityPercent: 80, publicTransportPercent: 12, evSharePercent: 3, buildingEfficiencyPercent: 0, greenCoverPercent: 8, renewableSharePercent: 15, gridCarbonIntensity: 550 },
  },
  {
    id: 'improved',
    label: 'Improved city',
    kind: 'alternative',
    description: 'Moderate transit investment, a retrofit programme and a cleaner grid. Incremental on every axis.',
    overrides: { trafficDensityPercent: 60, publicTransportPercent: 35, evSharePercent: 25, buildingEfficiencyPercent: 20, greenCoverPercent: 18, renewableSharePercent: 45, gridCarbonIntensity: 400 },
  },
  {
    id: 'sustainable',
    label: 'Sustainable city',
    kind: 'optimised',
    description: 'High transit share, deep retrofit, extensive greening and a largely decarbonised grid.',
    overrides: { trafficDensityPercent: 35, publicTransportPercent: 65, evSharePercent: 70, buildingEfficiencyPercent: 45, greenCoverPercent: 35, renewableSharePercent: 85, gridCarbonIntensity: 180 },
  },
  {
    id: 'ev-only',
    label: 'Electrification alone',
    kind: 'alternative',
    description: 'Every car electric, but nothing else changes — including the dirty grid. Tests whether electrification by itself is enough.',
    overrides: { trafficDensityPercent: 80, publicTransportPercent: 12, evSharePercent: 100, buildingEfficiencyPercent: 0, greenCoverPercent: 8, renewableSharePercent: 15, gridCarbonIntensity: 550 },
  },
  {
    id: 'greening',
    label: 'Greening alone',
    kind: 'alternative',
    description: 'Green cover tripled and nothing else changes. Shows both the cooling benefit and the modest scale of urban sequestration.',
    overrides: { trafficDensityPercent: 80, publicTransportPercent: 12, evSharePercent: 3, buildingEfficiencyPercent: 0, greenCoverPercent: 36, renewableSharePercent: 15, gridCarbonIntensity: 550 },
  },
]

export interface CityDailyResult {
  buildingElectricityMwh: number
  transportElectricityMwh: number
  transportFuelMwh: number
  emissionsTonnes: number
  sequestrationTonnes: number
  effectiveTemperatureC: number
  congestionFactor: number
  heatIslandOffsetC: number
}

/** The whole model for one day, extracted so it is testable on its own. */
export function computeDay(
  params: Record<string, number>,
  baseline: CityBaseline,
  areaKm2: number,
): CityDailyResult {
  const people = params.populationThousands * 1000

  // ── Temperature, with green-cover moderation ───────────────────────────
  const heatIslandOffsetC = UHI_COOLING_PER_GREEN_PERCENT * params.greenCoverPercent
  const baseTemperatureC = baseline.observedTemperatureC ?? 20
  const effectiveTemperatureC = baseTemperatureC + params.temperatureAnomalyK - heatIslandOffsetC

  // ── Buildings ──────────────────────────────────────────────────────────
  const baseBuildingKwhDay = (INTENSITIES.buildingElectricityKwhPerCapitaYear / 365) * people
  const efficiency = 1 - params.buildingEfficiencyPercent / 100
  // Only the cooling share responds to temperature; the rest does not.
  const coolingShare = INTENSITIES.coolingShareOfBuildingElectricity
  const temperatureDelta = effectiveTemperatureC - baseTemperatureC
  const coolingMultiplier = 1 + COOLING_SENSITIVITY_PER_K * temperatureDelta
  const buildingKwhDay =
    baseBuildingKwhDay * efficiency * (1 - coolingShare + coolingShare * Math.max(coolingMultiplier, 0))

  // ── Transport ──────────────────────────────────────────────────────────
  const passengerKmDay = INTENSITIES.passengerKmPerCapitaDay * people
  const transitShare = params.publicTransportPercent / 100
  const transitPassengerKm = passengerKmDay * transitShare
  const carPassengerKm = passengerKmDay * (1 - transitShare)
  const vehicleKm = carPassengerKm / INTENSITIES.carOccupancy

  const congestionFactor = 1 + CONGESTION_ENERGY_PENALTY * (params.trafficDensityPercent / 100)
  const evShare = params.evSharePercent / 100

  const evKwhDay = vehicleKm * evShare * INTENSITIES.evEnergyKwhPerKm * congestionFactor
  const iceKwhDay = vehicleKm * (1 - evShare) * INTENSITIES.iceEnergyKwhPerKm * congestionFactor
  const transitKwhDay = transitPassengerKm * INTENSITIES.transitEnergyKwhPerPassengerKm

  const transportElectricityKwhDay = evKwhDay + transitKwhDay
  const transportFuelKwhDay = iceKwhDay

  // ── Emissions ──────────────────────────────────────────────────────────
  const fossilShare = 1 - params.renewableSharePercent / 100
  const electricityKwhDay = buildingKwhDay + transportElectricityKwhDay
  const electricityEmissionsKg =
    (electricityKwhDay * fossilShare * params.gridCarbonIntensity) / 1000
  const fuelEmissionsKg = (transportFuelKwhDay * INTENSITIES.fuelEmissionsGPerKwh) / 1000

  // ── Sequestration ──────────────────────────────────────────────────────
  const greenHectares = areaKm2 * 100 * (params.greenCoverPercent / 100)
  const sequestrationTonnesDay =
    (greenHectares * INTENSITIES.sequestrationTonnesPerHectareYear) / 365

  return {
    buildingElectricityMwh: buildingKwhDay / 1000,
    transportElectricityMwh: transportElectricityKwhDay / 1000,
    transportFuelMwh: transportFuelKwhDay / 1000,
    emissionsTonnes: (electricityEmissionsKg + fuelEmissionsKg) / 1000,
    sequestrationTonnes: sequestrationTonnesDay,
    effectiveTemperatureC,
    congestionFactor,
    heatIslandOffsetC,
  }
}

/** Urban area served, km². Derived from population at a documented density. */
export const ASSUMED_DENSITY_PEOPLE_PER_KM2 = 4500

export function urbanAreaKm2(params: Record<string, number>): number {
  return (params.populationThousands * 1000) / ASSUMED_DENSITY_PEOPLE_PER_KM2
}

export const cityEngine: SimulationEngine<CityState, CityBaseline> = {
  id: 'city',
  label: 'Urban energy & emissions engine',
  tickHours: 24,
  defaultDurationHours: 365 * 24,
  timeUnit: 'days',
  parameters: PARAMETERS,
  metrics: METRICS,
  series: SERIES,
  presets: PRESETS,
  disclaimer:
    'A transparent urban energy and emissions accounting model with heat-island and congestion feedbacks. Per-capita intensities are published averages across very different cities and a specific city can differ by a factor of two or more. No traffic data provider is integrated: traffic density is a scenario input, and nothing here observes or predicts real traffic. There is no pollutant dispersion component, so the measured air-quality index shown alongside is never altered by the model.',
  assumptions: [
    `Building electricity is ${INTENSITIES.buildingElectricityKwhPerCapitaYear} kWh per person per year, roughly the global urban average. Climate and income move this enormously.`,
    `${(INTENSITIES.coolingShareOfBuildingElectricity * 100).toFixed(0)} % of building electricity is space cooling and responds to temperature at ${(COOLING_SENSITIVITY_PER_K * 100).toFixed(0)} % per kelvin; the rest does not.`,
    `Travel is ${INTENSITIES.passengerKmPerCapitaDay} passenger-km per person per day at ${INTENSITIES.carOccupancy} occupancy, with cars at ${INTENSITIES.iceEnergyKwhPerKm} kWh/km (combustion) and ${INTENSITIES.evEnergyKwhPerKm} kWh/km (electric), and transit at ${INTENSITIES.transitEnergyKwhPerPassengerKm} kWh per passenger-km.`,
    `Congestion raises vehicle energy per kilometre by up to ${(CONGESTION_ENERGY_PENALTY * 100).toFixed(0)} % at saturation, consistent with urban versus highway drive-cycle comparisons.`,
    `Green cover moderates temperature at ${UHI_COOLING_PER_GREEN_PERCENT} K per percentage point, inside the 0.1–0.5 K per 10 points range published urban-greening studies report.`,
    `Urban vegetation sequesters ${INTENSITIES.sequestrationTonnesPerHectareYear} tCO₂e per hectare per year; published urban-forest studies span roughly 2–8.`,
    `Urban area is derived from population at ${ASSUMED_DENSITY_PEOPLE_PER_KM2} people/km². Real densities range from under 1 000 to over 30 000.`,
    'Liquid fuel is counted at 250 gCO₂e per kWh of fuel energy — combustion only, excluding extraction and refining.',
    'Industry, freight, aviation, heating fuels, water, waste and embodied emissions are all outside the boundary. This is not a full city inventory.',
    'Renewable supply is zero-carbon at the point of use, on the same basis as the Green Data Centre module.',
  ],

  init() {
    return {
      day: 0,
      cumulative: {
        buildingElectricityMwh: 0,
        transportElectricityMwh: 0,
        transportFuelMwh: 0,
        emissionsTonnes: 0,
        sequestrationTonnes: 0,
      },
      daily: {
        buildingElectricityMwh: 0,
        transportElectricityMwh: 0,
        transportFuelMwh: 0,
        emissionsTonnes: 0,
        effectiveTemperatureC: 0,
        congestionFactor: 1,
      },
    }
  },

  step(state, params, baseline, tickHours) {
    const days = tickHours / 24
    const day = computeDay(params, baseline, urbanAreaKm2(params))

    return {
      day: state.day + days,
      cumulative: {
        buildingElectricityMwh:
          state.cumulative.buildingElectricityMwh + day.buildingElectricityMwh * days,
        transportElectricityMwh:
          state.cumulative.transportElectricityMwh + day.transportElectricityMwh * days,
        transportFuelMwh: state.cumulative.transportFuelMwh + day.transportFuelMwh * days,
        emissionsTonnes: state.cumulative.emissionsTonnes + day.emissionsTonnes * days,
        sequestrationTonnes: state.cumulative.sequestrationTonnes + day.sequestrationTonnes * days,
      },
      daily: {
        buildingElectricityMwh: day.buildingElectricityMwh,
        transportElectricityMwh: day.transportElectricityMwh,
        transportFuelMwh: day.transportFuelMwh,
        emissionsTonnes: day.emissionsTonnes,
        effectiveTemperatureC: day.effectiveTemperatureC,
        congestionFactor: day.congestionFactor,
      },
    }
  },

  derive(state, params, baseline) {
    const days = Math.max(state.day, 1)
    const annualScale = 365 / days
    const day = computeDay(params, baseline, urbanAreaKm2(params))
    const people = params.populationThousands * 1000

    const electricityMwh =
      state.cumulative.buildingElectricityMwh + state.cumulative.transportElectricityMwh
    const annualEmissionsTonnes = state.cumulative.emissionsTonnes * annualScale
    const annualSequestrationTonnes = state.cumulative.sequestrationTonnes * annualScale

    return {
      annualElectricityGwh: (electricityMwh * annualScale) / 1000,
      annualEmissionsKt: annualEmissionsTonnes / 1000,
      perCapitaEmissionsKg: people > 0 ? (annualEmissionsTonnes * 1000) / people : null,
      netEmissionsKt: (annualEmissionsTonnes - annualSequestrationTonnes) / 1000,
      buildingElectricityGwh: (state.cumulative.buildingElectricityMwh * annualScale) / 1000,
      transportElectricityGwh: (state.cumulative.transportElectricityMwh * annualScale) / 1000,
      transportFuelGwh: (state.cumulative.transportFuelMwh * annualScale) / 1000,
      sequestrationTonnes: annualSequestrationTonnes,
      effectiveTemperatureC: day.effectiveTemperatureC,
      heatIslandOffsetC: day.heatIslandOffsetC,
      congestionFactor: day.congestionFactor,
      greenAreaHectares: urbanAreaKm2(params) * 100 * (params.greenCoverPercent / 100),
      mappedBuildingCount: baseline.mappedBuildingCount,
      mappedGreenCoverPercent: baseline.mappedGreenCoverPercent,
      observedAqi: baseline.observedAqi,
    }
  },

  sample(state) {
    return {
      t: Number(state.day.toFixed(1)),
      electricity: Number(
        (state.cumulative.buildingElectricityMwh + state.cumulative.transportElectricityMwh).toFixed(1),
      ),
      emissions: Number(state.cumulative.emissionsTonnes.toFixed(1)),
      dailyElectricity: Number(
        (state.daily.buildingElectricityMwh + state.daily.transportElectricityMwh).toFixed(2),
      ),
      temperature: Number(state.daily.effectiveTemperatureC.toFixed(2)),
      sequestration: Number(state.cumulative.sequestrationTonnes.toFixed(2)),
    } satisfies SeriesRow
  },

  explain(state, params, baseline) {
    const day = computeDay(params, baseline, urbanAreaKm2(params))
    const people = params.populationThousands * 1000
    const area = urbanAreaKm2(params)
    const r = (value: number, decimals = 2) => value.toFixed(decimals)

    return [
      `Population ${people.toLocaleString()} over ${r(area, 1)} km² at ${ASSUMED_DENSITY_PEOPLE_PER_KM2} people/km²`,
      `Green cover ${params.greenCoverPercent}% → heat-island moderation = ${UHI_COOLING_PER_GREEN_PERCENT} K/% × ${params.greenCoverPercent}% = ${r(day.heatIslandOffsetC, 2)} K`,
      `Effective temperature = ${r(baseline.observedTemperatureC ?? 20, 1)} °C observed + ${r(params.temperatureAnomalyK, 1)} K anomaly − ${r(day.heatIslandOffsetC, 2)} K greening = ${r(day.effectiveTemperatureC, 2)} °C`,
      `Buildings = ${INTENSITIES.buildingElectricityKwhPerCapitaYear} kWh/person/yr ÷ 365 × ${people.toLocaleString()} × ${r(1 - params.buildingEfficiencyPercent / 100, 2)} efficiency, with the ${(INTENSITIES.coolingShareOfBuildingElectricity * 100).toFixed(0)}% cooling share adjusted ${(COOLING_SENSITIVITY_PER_K * 100).toFixed(0)}%/K → ${r(day.buildingElectricityMwh, 1)} MWh/day`,
      `Travel = ${INTENSITIES.passengerKmPerCapitaDay} p-km/person/day; ${params.publicTransportPercent}% on transit, the rest by car at ${INTENSITIES.carOccupancy} occupancy`,
      `Congestion factor = 1 + ${CONGESTION_ENERGY_PENALTY} × ${params.trafficDensityPercent}% = ${r(day.congestionFactor, 3)}×`,
      `Transport = ${r(day.transportElectricityMwh, 2)} MWh/day electric + ${r(day.transportFuelMwh, 1)} MWh/day liquid fuel at ${params.evSharePercent}% EV share`,
      `Emissions = electricity × ${r(1 - params.renewableSharePercent / 100, 2)} non-renewable × ${params.gridCarbonIntensity} gCO₂e/kWh + fuel × ${INTENSITIES.fuelEmissionsGPerKwh} gCO₂e/kWh = ${r(day.emissionsTonnes, 1)} tCO₂e/day`,
      `Sequestration = ${r(area * 100 * (params.greenCoverPercent / 100), 0)} ha × ${INTENSITIES.sequestrationTonnesPerHectareYear} tCO₂e/ha/yr ÷ 365 = ${r(day.sequestrationTonnes, 2)} tCO₂e/day`,
      `After ${r(state.day, 0)} days: ${r(state.cumulative.emissionsTonnes, 0)} tCO₂e emitted, ${r(state.cumulative.sequestrationTonnes, 0)} tCO₂e sequestered`,
    ]
  },

  elapsedHours(state) {
    return state.day * 24
  },
}
