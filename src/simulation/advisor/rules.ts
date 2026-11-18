/**
 * The advisor's rule set.
 *
 * Each rule is a named, deterministic function with an explicit trigger. When
 * a rule proposes a change it measures the effect by re-running the engine, and
 * withholds the recommendation if the measured effect turns out to be
 * immaterial. That is the whole discipline: the advisor never asserts a benefit
 * it has not computed.
 */

import { agricultureEngine } from '../engines/agriculture.ts'
import { cityEngine } from '../engines/city.ts'
import { climateEngine } from '../engines/climate.ts'
import { dataCentreEngine } from '../engines/datacentre.ts'
import { forestEngine } from '../engines/forest.ts'
import { wasteEngine } from '../engines/waste.ts'
import { waterEngine } from '../engines/water.ts'
import type { MetricDefinition } from '../types/engine.ts'
import { formatMagnitude, isMaterial, magnitude, number } from './helpers.ts'
import type { AdvisorContext, AdvisorFinding, AdvisorRule } from './types.ts'

const METRICS_BY_ENGINE: Record<string, MetricDefinition[]> = {
  climate: climateEngine.metrics,
  waste: wasteEngine.metrics,
  city: cityEngine.metrics,
  datacentre: dataCentreEngine.metrics,
  forest: forestEngine.metrics,
  water: waterEngine.metrics,
  agriculture: agricultureEngine.metrics,
}

/** Builds a finding from a probe, or returns null if nothing material changed. */
function probeFinding(
  context: AdvisorContext,
  options: {
    id: string
    title: string
    overrides: Record<string, number>
    /** Metrics to quantify, in the order they should be shown. */
    track: string[]
    /** Builds the recommendation text from the measured magnitudes. */
    detail: (formatted: Record<string, string>, raw: Record<string, number>) => string
    basis: string
    actionLabel: string
    weight: number
    /** Force a kind; otherwise it is derived from the measured directions. */
    kind?: AdvisorFinding['kind']
  },
): AdvisorFinding | null {
  const definitions = METRICS_BY_ENGINE[context.engineId] ?? []
  const alternative = context.evaluate(options.overrides)

  const magnitudes = options.track
    .map((key) => magnitude(context, definitions, key, alternative))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  if (magnitudes.length === 0) return null
  // Nothing worth saying if the change moves nothing measurable.
  if (!magnitudes.some((entry) => isMaterial(entry))) return null

  const formatted: Record<string, string> = {}
  const raw: Record<string, number> = {}
  options.track.forEach((key, index) => {
    const entry = magnitudes.find((item) => item.label === (definitions.find((d) => d.key === key)?.label))
    if (entry) {
      formatted[key] = formatMagnitude(entry)
      raw[key] = entry.percent ?? entry.value
    }
    void index
  })

  const improvements = magnitudes.filter((entry) => entry.isImprovement && isMaterial(entry))
  const regressions = magnitudes.filter(
    (entry) => !entry.isImprovement && isMaterial(entry) && entry.value !== 0,
  )
  const hasDirection = magnitudes.some((entry) => entry.isImprovement) || regressions.length > 0

  const kind: AdvisorFinding['kind'] =
    options.kind ??
    (improvements.length > 0 && regressions.length > 0
      ? 'trade-off'
      : improvements.length > 0
        ? 'opportunity'
        : hasDirection
          ? 'caution'
          : 'observation')

  return {
    id: options.id,
    kind,
    title: options.title,
    detail: options.detail(formatted, raw),
    basis: options.basis,
    magnitudes,
    action: { label: options.actionLabel, overrides: options.overrides },
    weight: options.weight,
  }
}

// ── Green Data Centre ──────────────────────────────────────────────────────

const dataCentreRules: AdvisorRule[] = [
  (context) => {
    // Trigger: utilisation low enough that the fleet is mostly paying idle power.
    if (context.params.baseUtilisationPercent > 45) return null
    const targetUtilisation = 70
    const ratio = context.params.baseUtilisationPercent / targetUtilisation
    const consolidatedCount = Math.max(Math.round(context.params.serverCount * ratio), 10)
    return probeFinding(context, {
      id: 'dc-consolidate',
      title: 'Consolidate the workload onto fewer servers',
      overrides: { serverCount: consolidatedCount, baseUtilisationPercent: targetUtilisation },
      track: ['totalEnergyMwh', 'emissionsTonnes', 'energyPerWorkUnit', 'workUnits'],
      detail: (formatted) =>
        `The fleet averages ${number(context.params.baseUtilisationPercent, 0)} % utilisation, so most of its power is going on idle draw rather than work. Running the same load on ${consolidatedCount} servers at ${targetUtilisation} % changes facility energy by ${formatted.totalEnergyMwh ?? '—'} and energy per unit of work by ${formatted.energyPerWorkUnit ?? '—'}.`,
      basis: `Rule "low-utilisation consolidation": fires when mean utilisation is at or below 45 %. Server power is modelled as idle + (rated − idle) × utilisation, so a server at ${number(context.params.baseUtilisationPercent, 0)} % still draws ${number(context.params.idlePowerFraction * 100, 0)} % of rated power doing almost nothing. The figures above were measured by re-running the simulation with ${consolidatedCount} servers at ${targetUtilisation} %.`,
      actionLabel: `Apply: ${consolidatedCount} servers at ${targetUtilisation} %`,
      weight: 90,
    })
  },

  (context) => {
    // Trigger: a design overhead implying PUE 1.4 or worse.
    if (context.params.coolingOverheadFraction < 0.4) return null
    const target = 0.25
    return probeFinding(context, {
      id: 'dc-cooling',
      title: 'Reduce cooling and distribution overhead',
      overrides: { coolingOverheadFraction: target },
      track: ['pue', 'totalEnergyMwh', 'emissionsTonnes'],
      detail: (formatted) =>
        `Overhead is ${number(context.params.coolingOverheadFraction, 2)} × IT load, which sets a design PUE of ${number(1 + context.params.coolingOverheadFraction, 2)}. Containment, variable-speed fans and a raised setpoint commonly reach ${target}. That change moves PUE by ${formatted.pue ?? '—'} and facility energy by ${formatted.totalEnergyMwh ?? '—'}.`,
      basis: `Rule "high cooling overhead": fires above 0.40 × IT load, i.e. a design PUE of 1.4 or worse. PUE here is the ISO-IEC 30134-2 ratio of total facility energy to IT energy, computed over the whole run. The figures were measured by re-running with overhead at ${target}.`,
      actionLabel: `Apply: overhead ${target} × IT load`,
      weight: 85,
    })
  },

  (context) => {
    const throttled = context.metrics.throttledHours
    if (typeof throttled !== 'number' || throttled <= 0) return null
    const target = Math.min(context.params.coolingCapacityRatio + 0.4, 2)
    return probeFinding(context, {
      id: 'dc-throttle',
      title: 'Cooling capacity is costing you usable compute',
      overrides: { coolingCapacityRatio: target },
      track: ['throttledHours', 'workUnits', 'hallTemperatureC', 'totalEnergyMwh'],
      detail: (formatted) =>
        `The hall spent ${number(throttled, 0)} hours above the thermal limit, forcing the fleet below the workload it was asked to run. Raising installed cooling to ${number(target, 2)} × peak IT heat changes throttled hours by ${formatted.throttledHours ?? '—'} and work delivered by ${formatted.workUnits ?? '—'} — at a cost of ${formatted.totalEnergyMwh ?? '—'} in energy.`,
      basis: `Rule "thermal throttling detected": fires whenever throttled hours exceed zero. The model throttles linearly between 32 °C and 40 °C hall temperature. This is a trade-off, not a free win: more cooling capacity costs energy, and the figures above show both sides.`,
      actionLabel: `Apply: cooling at ${number(target, 2)} × peak heat`,
      weight: 95,
    })
  },

  (context) => {
    if (context.params.renewableSharePercent >= 70) return null
    const target = 85
    return probeFinding(context, {
      id: 'dc-renewable',
      title: 'Procuring cleaner supply cuts emissions without touching energy',
      overrides: { renewableSharePercent: target },
      track: ['emissionsTonnes', 'totalEnergyMwh'],
      detail: (formatted) =>
        `Supply is ${number(context.params.renewableSharePercent, 0)} % zero-carbon. Raising it to ${target} % changes emissions by ${formatted.emissionsTonnes ?? '—'} while facility energy moves by ${formatted.totalEnergyMwh ?? '—'} — which is to say, not at all. Clean supply addresses the carbon, not the consumption.`,
      basis: `Rule "supply decarbonisation headroom": fires below 70 % renewable share. Emissions are computed as facility energy × non-renewable share × grid carbon intensity, so the energy line is untouched by definition. Note that this accounting treats renewable supply as zero-carbon at the point of use and ignores the difference between contractual and physical supply.`,
      actionLabel: `Apply: ${target} % renewable supply`,
      weight: 70,
    })
  },
]

// ── Smart City ─────────────────────────────────────────────────────────────

const cityRules: AdvisorRule[] = [
  (context) => {
    if (context.params.publicTransportPercent >= 50) return null
    const target = Math.min(context.params.publicTransportPercent + 30, 70)
    return probeFinding(context, {
      id: 'city-transit',
      title: 'Shifting trips to public transport compounds through congestion',
      overrides: { publicTransportPercent: target },
      track: ['annualEmissionsKt', 'transportFuelGwh', 'annualElectricityGwh'],
      detail: (formatted) =>
        `Transit carries ${number(context.params.publicTransportPercent, 0)} % of passenger-kilometres. Raising that to ${target} % changes annual emissions by ${formatted.annualEmissionsKt ?? '—'} and liquid fuel by ${formatted.transportFuelGwh ?? '—'}. The saving exceeds the share of trips moved, because transit at 0.11 kWh per passenger-km displaces car travel at 0.62 kWh per vehicle-km carrying 1.4 people.`,
      basis: `Rule "low transit mode share": fires below 50 %. Figures measured by re-running the model at ${target} % mode share, holding everything else constant.`,
      actionLabel: `Apply: ${target} % transit share`,
      weight: 88,
    })
  },

  (context) => {
    if (context.params.evSharePercent >= 60) return null
    return probeFinding(context, {
      id: 'city-ev',
      title: 'Electrifying the fleet moves emissions to the grid, it does not remove them',
      overrides: { evSharePercent: 100 },
      track: ['annualEmissionsKt', 'transportFuelGwh', 'transportElectricityGwh'],
      detail: (formatted) =>
        `Full electrification changes annual emissions by ${formatted.annualEmissionsKt ?? '—'}, eliminating liquid fuel (${formatted.transportFuelGwh ?? '—'}) while raising grid demand (${formatted.transportElectricityGwh ?? '—'}). With the grid at ${number(context.params.gridCarbonIntensity, 0)} gCO₂e/kWh and ${number(context.params.renewableSharePercent, 0)} % renewable, how much that actually buys depends almost entirely on the supply, not the vehicles.`,
      basis: `Rule "electrification headroom": fires below 60 % EV share. Measured by re-running at 100 % EV share with the grid left exactly as it is, which is the point: the benefit is conditional on supply.`,
      actionLabel: 'Apply: 100 % electric fleet',
      weight: 75,
    })
  },

  (context) => {
    if (context.params.buildingEfficiencyPercent >= 30) return null
    const target = 40
    return probeFinding(context, {
      id: 'city-retrofit',
      title: 'Building retrofit is the largest single lever here',
      overrides: { buildingEfficiencyPercent: target },
      track: ['buildingElectricityGwh', 'annualElectricityGwh', 'annualEmissionsKt'],
      detail: (formatted) =>
        `Buildings dominate this city's electricity. A ${target} % efficiency improvement changes building electricity by ${formatted.buildingElectricityGwh ?? '—'} and total annual emissions by ${formatted.annualEmissionsKt ?? '—'}.`,
      basis: `Rule "retrofit headroom": fires below 30 % efficiency improvement. Building demand is modelled at 2600 kWh per person per year scaled by the efficiency factor, with the 18 % cooling share additionally responding to temperature.`,
      actionLabel: `Apply: ${target} % efficiency improvement`,
      weight: 86,
    })
  },

  (context) => {
    if (context.params.greenCoverPercent >= 25) return null
    const target = 30
    return probeFinding(context, {
      id: 'city-green',
      title: 'Greening cools the city, which shows up in the energy bill',
      overrides: { greenCoverPercent: target },
      track: ['effectiveTemperatureC', 'buildingElectricityGwh', 'sequestrationTonnes', 'annualEmissionsKt'],
      detail: (formatted) =>
        `Raising green cover from ${number(context.params.greenCoverPercent, 0)} % to ${target} % changes the effective urban temperature by ${formatted.effectiveTemperatureC ?? '—'} and building electricity by ${formatted.buildingElectricityGwh ?? '—'}. Sequestration changes by ${formatted.sequestrationTonnes ?? '—'} — real, but small beside the city's total emissions. The cooling effect is the larger benefit here, not the carbon uptake.`,
      basis: `Rule "green cover headroom": fires below 25 %. Cooling is applied at 0.03 K per percentage point of cover, inside the range published urban-greening studies report, and feeds the 18 % cooling share of building demand at 4 % per kelvin.`,
      actionLabel: `Apply: ${target} % green cover`,
      weight: 72,
    })
  },

  (context) => {
    const aqi = context.metrics.observedAqi
    if (typeof aqi !== 'number' || aqi <= 100) return null
    return {
      id: 'city-aqi',
      kind: 'observation',
      title: 'Measured air quality is above the EPA "Moderate" band',
      detail: `The nearest OpenAQ station gives a US EPA index of ${number(aqi, 0)} for ${context.locationLabel}. That is a measurement, not a model output, and nothing in this simulation changes it: there is no pollutant dispersion component here. The energy and emissions levers above act on greenhouse gases, which are a separate question from local air quality — though traffic reduction happens to help both.`,
      basis:
        'Rule "measured AQI above 100": fires on the observed index from the air-quality panel. No model output contributes to this value.',
      magnitudes: [],
      weight: 60,
    }
  },
]

// ── AquaGuard ──────────────────────────────────────────────────────────────

const waterRules: AdvisorRule[] = [
  (context) => {
    const spill = context.metrics.totalSpillMcm
    if (typeof spill !== 'number' || spill <= 0) return null
    const target = Math.min(context.params.releaseCumecs + 25, 400)
    return probeFinding(context, {
      id: 'water-prerelease',
      title: 'Water is being spilled — pre-release would recover some of it',
      overrides: { releaseCumecs: target, initialFillPercent: Math.max(context.params.initialFillPercent - 20, 0) },
      track: ['totalSpillMcm', 'storageMcm', 'deficitDays', 'daysAboveFloodThreshold'],
      detail: (formatted) =>
        `${number(spill, 1)} Mm³ left over the spillway, which is supply lost. Creating headroom in advance — drawing down 20 points and releasing at ${target} m³/s — changes spill by ${formatted.totalSpillMcm ?? '—'} and end-of-run storage by ${formatted.storageMcm ?? '—'}. That is the trade: less spill, but less water banked for a dry spell.`,
      basis:
        'Rule "spill detected": fires whenever cumulative spill exceeds zero. Both sides of the trade are measured by re-running the balance with the drawdown and higher release applied.',
      actionLabel: `Apply: pre-release at ${target} m³/s`,
      weight: 92,
    })
  },

  (context) => {
    if (context.params.distributionEfficiencyPercent >= 88) return null
    const target = 92
    return probeFinding(context, {
      id: 'water-leakage',
      title: 'Leakage reduction is the cheapest source of supply available',
      overrides: { distributionEfficiencyPercent: target },
      track: ['storageMcm', 'leakageMcm', 'deficitDays', 'unmetDemandMcm'],
      detail: (formatted) =>
        `At ${number(context.params.distributionEfficiencyPercent, 0)} % distribution efficiency, ${number(100 - context.params.distributionEfficiencyPercent, 0)} % of everything abstracted never reaches a user. Raising efficiency to ${target} % delivers exactly the same service while changing end-of-run storage by ${formatted.storageMcm ?? '—'} and leakage by ${formatted.leakageMcm ?? '—'}.`,
      basis: `Rule "distribution losses above 12 %": fires below 88 % efficiency. The model draws demand ÷ efficiency from storage, so recovered leakage is water that simply stays in the reservoir. No new infrastructure, no new catchment.`,
      actionLabel: `Apply: ${target} % distribution efficiency`,
      weight: 90,
    })
  },

  (context) => {
    const deficitDays = context.metrics.deficitDays
    if (typeof deficitDays !== 'number' || deficitDays <= 0) return null
    const target = Math.max(context.params.dailyDemandMcm * 0.8, 0)
    return probeFinding(context, {
      id: 'water-restriction',
      title: 'Demand exceeded supply — restrictions would close the gap',
      overrides: { dailyDemandMcm: Number(target.toFixed(2)) },
      track: ['deficitDays', 'unmetDemandMcm', 'storageMcm'],
      detail: (formatted) =>
        `Demand could not be met on ${number(deficitDays, 0)} day(s). A 20 % demand restriction changes days with unmet demand by ${formatted.deficitDays ?? '—'} and end-of-run storage by ${formatted.storageMcm ?? '—'}. Restrictions have real costs this model does not represent; it only shows the hydrology.`,
      basis:
        'Rule "unmet demand detected": fires whenever the balance could not supply demand from storage. The model reports a shortfall rather than drawing storage negative.',
      actionLabel: 'Apply: 20 % demand restriction',
      weight: 94,
    })
  },

  (context) => {
    if (context.params.temperatureAnomalyK < 1) return null
    return probeFinding(context, {
      id: 'water-evaporation',
      title: 'The temperature scenario is costing storage through evaporation',
      overrides: { temperatureAnomalyK: 0 },
      track: ['totalEvaporationMcm', 'storageMcm'],
      detail: (formatted) =>
        `The shared temperature anomaly of +${number(context.params.temperatureAnomalyK, 1)} K raises open-water evaporation. Removing it would change evaporation loss by ${formatted.totalEvaporationMcm ?? '—'} and end-of-run storage by ${formatted.storageMcm ?? '—'}. This lever is set in the Climate module and reaches the reservoir through the evaporation term.`,
      basis: `Rule "warming scenario active": fires above +1 K. Evaporation is modelled at 4 mm/day at 20 °C scaled 6 % per kelvin over the reservoir's surface area, which itself shrinks as the level falls.`,
      actionLabel: 'Compare: no temperature anomaly',
      weight: 68,
      kind: 'observation',
    })
  },
]

// ── AgriFuture ─────────────────────────────────────────────────────────────

const agricultureRules: AdvisorRule[] = [
  (context) => {
    if (context.params.strategy !== 0) return null
    return probeFinding(context, {
      id: 'agri-trigger',
      title: 'Switch from a calendar schedule to soil-moisture triggering',
      overrides: { strategy: 1 },
      track: ['totalIrrigationMm', 'stressDays', 'deepPercolationMm', 'waterProductivity'],
      detail: (formatted) =>
        `A fixed ${number(context.params.irrigationIntervalDays, 0)}-day schedule irrigates whether or not the soil needs it — including straight after rain. Triggering on root-zone depletion instead changes irrigation applied by ${formatted.totalIrrigationMm ?? '—'}, water drained below the roots by ${formatted.deepPercolationMm ?? '—'} and days under stress by ${formatted.stressDays ?? '—'}.`,
      basis:
        'Rule "calendar scheduling in use": fires whenever the fixed-interval strategy is selected. The triggered strategy irrigates when depletion reaches the FAO-56 readily available water threshold, which is the point at which the crop would begin to experience stress.',
      actionLabel: 'Apply: soil-moisture triggered',
      weight: 90,
    })
  },

  (context) => {
    if (context.params.applicationEfficiencyPercent >= 85) return null
    const target = 90
    return probeFinding(context, {
      id: 'agri-efficiency',
      title: 'Raising application efficiency delivers more water to the crop per mm pumped',
      overrides: { applicationEfficiencyPercent: target },
      track: ['waterProductivity', 'stressDays', 'totalIrrigationMm', 'deepPercolationMm'],
      detail: (formatted) =>
        `At ${number(context.params.applicationEfficiencyPercent, 0)} % application efficiency, ${number(100 - context.params.applicationEfficiencyPercent, 0)} % of what is applied never reaches the root zone. Moving to drip-level efficiency of ${target} % changes transpiration per mm applied by ${formatted.waterProductivity ?? '—'} and days under stress by ${formatted.stressDays ?? '—'}.`,
      basis: `Rule "low application efficiency": fires below 85 %. Surface irrigation typically runs 60–80 %; well-managed drip reaches about 90 %. Figures measured by re-running the FAO-56 balance at ${target} %.`,
      actionLabel: `Apply: ${target} % application efficiency`,
      weight: 82,
    })
  },

  (context) => {
    const stressDays = context.metrics.stressDays
    if (typeof stressDays !== 'number' || stressDays <= 3) return null
    const deficit = context.metrics.deficitMm
    return {
      id: 'agri-stress',
      kind: 'caution',
      title: 'The crop spent a material part of the run water-limited',
      detail: `Depletion exceeded the readily available water on ${number(stressDays, 0)} day(s), so the crop could not transpire at its potential rate. Over the run, actual transpiration fell short of potential demand by ${number(typeof deficit === 'number' ? deficit : null, 1)} mm. What that costs in yield is outside this model: there is no crop growth model here, and the platform makes no yield claim.`,
      basis:
        'Rule "sustained water stress": fires above 3 stress days. Stress is the FAO-56 water-stress coefficient Ks falling below 1, which happens once root-zone depletion passes p × TAW.',
      magnitudes: [],
      weight: 88,
    }
  },

  (context) => {
    if (context.params.precipitationScalePercent >= 70) return null
    return probeFinding(context, {
      id: 'agri-climate-link',
      title: 'The rainfall scenario set in Climate is driving this irrigation demand',
      overrides: { precipitationScalePercent: 100 },
      track: ['totalIrrigationMm', 'stressDays', 'effectiveRainfallMm'],
      detail: (formatted) =>
        `Rainfall is scaled to ${number(context.params.precipitationScalePercent, 0)} % of observed by the shared climate lever. Returning it to 100 % changes irrigation required by ${formatted.totalIrrigationMm ?? '—'} and stress days by ${formatted.stressDays ?? '—'}. The connection runs through the FAO-56 balance: scaled rainfall becomes less effective rainfall, so more has to be made up by irrigation.`,
      basis:
        'Rule "drought scenario active": fires below 70 % rainfall scaling. This lever is shared with the Climate and AquaGuard modules.',
      actionLabel: 'Compare: observed rainfall',
      weight: 76,
      kind: 'observation',
    })
  },
]

// ── Forest ─────────────────────────────────────────────────────────────────

const forestRules: AdvisorRule[] = [
  (context) => {
    if (context.params.vegetationDensity < 0.7) return null
    const target = 0.5
    return probeFinding(context, {
      id: 'forest-continuity',
      title: 'Breaking fuel continuity limits spread more reliably than fighting the weather',
      overrides: { vegetationDensity: target },
      track: ['burnedHectares', 'burnedSharePercent'],
      detail: (formatted) =>
        `At ${number(context.params.vegetationDensity, 2)} fuel-cell density the fuel bed is continuous, so the fire front always finds somewhere to go. Thinning to ${target} changes simulated area burned by ${formatted.burnedHectares ?? '—'}. Below roughly 0.6 the bed stops percolating and fires self-extinguish on the gaps — which is why fuel breaks work.`,
      basis: `Rule "continuous fuel bed": fires at or above 0.70 density. Measured by re-running the cellular automaton at ${target} with identical weather. This is an educational model, not an operational prescription: real fuel treatment design needs surveyed fuel models and a trained analyst.`,
      actionLabel: `Compare: ${target} vegetation density`,
      weight: 85,
    })
  },

  (context) => {
    const moisture = context.metrics.effectiveFuelMoisturePercent
    const spread = context.metrics.spreadRateMPerHour
    if (typeof moisture !== 'number' || typeof spread !== 'number' || spread < 150) return null
    return {
      id: 'forest-conditions',
      kind: 'caution',
      title: 'Current inputs give a high simulated rate of spread',
      detail: `Effective fine-fuel moisture is ${number(moisture, 1)} % and the head-fire rate of spread is ${number(spread, 0)} m/h — driven by ${number(context.params.windSpeedKmh, 0)} km/h wind and ${number(context.params.relativeHumidityPercent, 0)} % humidity. Wind enters the spread rate exponentially, so it dominates: halving the wind does far more than halving the spread.`,
      basis:
        'Rule "high simulated spread rate": fires above 150 m/h head-fire spread. This is the model\'s own output under the inputs you set, and is not a forecast for this location. Satellite detections shown elsewhere in this module are separate real measurements.',
      magnitudes: [],
      weight: 80,
    }
  },

  (context) => {
    const detections = context.metrics.satelliteDetectionCount
    if (typeof detections !== 'number' || detections <= 0) return null
    return {
      id: 'forest-detections',
      kind: 'observation',
      title: `${number(detections, 0)} satellite fire detection(s) in this area`,
      detail: `NASA FIRMS reports ${number(detections, 0)} thermal anomalies near ${context.locationLabel}. These are real measurements of fires that occurred — entirely separate from the propagation simulation above, which models a hypothetical fire under conditions you set. The two are never combined in any figure on this page.`,
      basis:
        'Rule "satellite detections present": fires whenever FIRMS returned at least one detection. Reported directly from the provider; no model output contributes to it.',
      magnitudes: [],
      weight: 65,
    }
  },

  (context) => {
    if (context.params.temperatureAnomalyK < 1) return null
    return probeFinding(context, {
      id: 'forest-climate-link',
      title: 'The temperature scenario set in Climate is drying the fuel here',
      overrides: { temperatureAnomalyK: 0 },
      track: ['effectiveFuelMoisturePercent', 'burnedHectares', 'spreadRateMPerHour'],
      detail: (formatted) =>
        `The shared +${number(context.params.temperatureAnomalyK, 1)} K anomaly lowers effective fine-fuel moisture. Removing it changes moisture by ${formatted.effectiveFuelMoisturePercent ?? '—'} and simulated area burned by ${formatted.burnedHectares ?? '—'}. The connection runs through the temperature term in the fuel-moisture adjustment, at 0.18 points of moisture per kelvin.`,
      basis: 'Rule "warming scenario active": fires above +1 K. This lever is shared with Climate, AquaGuard and AgriFuture.',
      actionLabel: 'Compare: no temperature anomaly',
      weight: 70,
      kind: 'observation',
    })
  },
]

// ── Smart Waste ────────────────────────────────────────────────────────────

const wasteRules: AdvisorRule[] = [
  (context) => {
    const missed = context.metrics.missedByBusyDiverter
    if (typeof missed !== 'number' || missed < 5) return null
    const slower = Number((context.params.beltSpeedMps * 0.6).toFixed(2))
    return probeFinding(context, {
      id: 'waste-belt-speed',
      title: 'The belt is outrunning the sorting effectors',
      overrides: { beltSpeedMps: Math.max(slower, 0.05) },
      track: ['recoveryRatePercent', 'missedByBusyDiverter', 'throughputKgPerHour', 'residualPercent'],
      detail: (formatted) =>
        `${number(missed, 0)} item(s) reached an effector that was still occupied and went to residual. Slowing the belt to ${slower} m/s changes recovery by ${formatted.recoveryRatePercent ?? '—'} and misses by ${formatted.missedByBusyDiverter ?? '—'}. Throughput changes by ${formatted.throughputKgPerHour ?? '—'} — that is the cost, and whether it is worth paying depends on what the recovered material is worth.`,
      basis: `Rule "effector saturation": fires above 5 missed items. Each effector is occupied ${number(context.params.diverterCycleSeconds, 1)} s per pick; an item arriving during that window passes it.`,
      actionLabel: `Apply: ${slower} m/s belt speed`,
      weight: 88,
    })
  },

  (context) => {
    if (context.params.diverterCount >= 5) return null
    return probeFinding(context, {
      id: 'waste-effectors',
      title: 'Uncovered material streams cannot be recovered at all',
      overrides: { diverterCount: 5 },
      track: ['recoveryRatePercent', 'residualPercent', 'purityPercent'],
      detail: (formatted) =>
        `With ${number(context.params.diverterCount, 0)} effector(s), only ${number(context.params.diverterCount, 0)} material stream(s) have anywhere to go; everything else reaches residual regardless of how well it was classified. Adding effectors to cover all five recyclable streams changes recovery by ${formatted.recoveryRatePercent ?? '—'} and residual by ${formatted.residualPercent ?? '—'}.`,
      basis:
        'Rule "incomplete stream coverage": fires below 5 effectors. Effectors are assigned in order of value recovered per unit of effector time: cardboard, plastic, metal, paper, glass.',
      actionLabel: 'Apply: five effectors',
      weight: 86,
    })
  },

  (context) => {
    if (context.params.contaminationPercent <= 5) return null
    return probeFinding(context, {
      id: 'waste-contamination',
      title: 'Feed contamination is capping output quality, not the machinery',
      overrides: { contaminationPercent: 2 },
      track: ['purityPercent', 'recoveryRatePercent', 'misroutedKg'],
      detail: (formatted) =>
        `${number(context.params.contaminationPercent, 0)} % of items are too soiled or composite to classify, and they land in the wrong bin regardless of how accurate the sorter is. Reducing contamination to 2 % through source separation changes output purity by ${formatted.purityPercent ?? '—'} and misrouted mass by ${formatted.misroutedKg ?? '—'}. Purity is what determines whether a bale sells or is rejected.`,
      basis:
        'Rule "high feed contamination": fires above 5 %. Contaminated items misclassify independently of the accuracy parameter, which is why upstream separation beats downstream technology here.',
      actionLabel: 'Apply: 2 % contamination',
      weight: 92,
    })
  },

  () => ({
    id: 'waste-no-classifier',
    kind: 'limitation',
    title: 'No trained classifier exists in this application',
    detail:
      'Classification here is a rule-based draw against the accuracy parameter you set, weighted by how separable each material physically is. It is a model of line behaviour, not image recognition. No accuracy figure on this page describes a computer-vision system, because there is no computer-vision system.',
    basis:
      'Stated unconditionally, because it is a property of the application rather than of the current configuration.',
    magnitudes: [],
    weight: 50,
  }),
]

// ── Climate ────────────────────────────────────────────────────────────────

const climateRules: AdvisorRule[] = [
  (context) => {
    const committed = context.metrics.equilibriumWarmingK
    const transient = context.metrics.additionalWarmingK
    if (typeof committed !== 'number' || typeof transient !== 'number' || committed <= transient + 0.05) {
      return null
    }
    return {
      id: 'climate-commitment',
      kind: 'observation',
      title: 'There is warming in the pipeline beyond what the run shows',
      detail: `The model reached ${number(transient, 2)} K of additional warming over the simulated span, but the forcing at the end of the run implies ${number(committed, 2)} K at equilibrium. The difference is heat the ocean has absorbed but not yet returned. Stopping the forcing increase today would not stop the warming — that lag is the single most important thing this model has to show.`,
      basis:
        'Rule "committed warming exceeds transient": fires when F/λ exceeds the transient response by more than 0.05 K. Both come from the same one-box energy balance: C·dT/dt = F − λ·T, with λ = 1.3 W/m²/K and C = 8.5 W·yr/m²/K.',
      magnitudes: [],
      weight: 90,
    }
  },

  (context) => {
    if (context.params.co2Pathway === 3 || context.params.co2Pathway === 4) return null
    return probeFinding(context, {
      id: 'climate-mitigation',
      title: 'Compare a strong-mitigation pathway',
      overrides: { co2Pathway: 3 },
      track: ['totalWarmingK', 'co2Ppm', 'forcingWm2', 'scenarioAnnualPrecipitation'],
      detail: (formatted) =>
        `Switching to the slow-accumulation pathway changes total warming at the end of the run by ${formatted.totalWarmingK ?? '—'} and CO₂ concentration by ${formatted.co2Ppm ?? '—'}. Note how much smaller the temperature change is than the concentration change: thermal inertia means the benefit of mitigation arrives slowly, which is an argument for acting earlier rather than against acting.`,
      basis:
        'Rule "non-mitigation pathway selected": fires on any pathway other than the slow-growth or declining options. Measured by re-running the energy balance with that pathway and nothing else changed. These are illustrative concentration trends, not emissions scenarios and not CMIP6 projections.',
      actionLabel: 'Compare: strong mitigation pathway',
      weight: 80,
    })
  },

  (context) => {
    if (context.seededFromObservation) return null
    return {
      id: 'climate-no-baseline',
      kind: 'limitation',
      title: 'No observed climatology has loaded for this location',
      detail: `Without an ERA5 record the model has no observed starting point, so absolute temperatures cannot be shown — only the modelled change. Metrics that depend on the baseline are reported as unavailable rather than estimated.`,
      basis: 'Rule "baseline not seeded from observation": fires when the archive request returned nothing usable.',
      magnitudes: [],
      weight: 95,
    }
  },

  () => ({
    id: 'climate-not-cmip6',
    kind: 'limitation',
    title: 'This is a zero-dimensional model, not a climate projection',
    detail:
      'One well-mixed heat reservoir, a logarithmic CO₂ forcing and a linear feedback. It has no spatial structure, no ocean circulation and no atmospheric dynamics. It shows the global-mean transient response to a forcing change, anchored to this location\'s observed record. It is not CMIP6, and no figure it produces should be read as a projection for this place.',
    basis: 'Stated unconditionally, because it is a property of the model rather than of the current scenario.',
    magnitudes: [],
    weight: 55,
  }),
]

export const RULES_BY_ENGINE: Record<string, AdvisorRule[]> = {
  climate: climateRules,
  waste: wasteRules,
  city: cityRules,
  datacentre: dataCentreRules,
  forest: forestRules,
  water: waterRules,
  agriculture: agricultureRules,
}
