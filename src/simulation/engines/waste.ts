/**
 * Materials recovery facility (MRF) engine.
 *
 * A discrete-item conveyor simulation: waste arrives on a belt, passes a
 * classification station, and is diverted by a finite number of sorting
 * effectors into material bins. Items the effectors cannot reach in time
 * continue to the residual line.
 *
 * The honest framing, repeated in the interface: **there is no trained
 * classifier here.** Classification is a rule-based demonstration whose
 * per-material hit rates are parameters the user sets, drawn deterministically
 * from a seeded generator. It is a model of how a sorting line behaves, not an
 * image-recognition system, and it makes no claim about computer vision.
 *
 * The feed composition options are real published figures — World Bank
 * "What a Waste 2.0" (Kaza et al., 2018) — not invented percentages.
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
import { createPrng } from '../calculations/prng.ts'

export const MATERIALS = ['plastic', 'paper', 'glass', 'metal', 'cardboard', 'organic', 'other'] as const
export type Material = (typeof MATERIALS)[number]

/** Materials with an established recycling market in a typical MRF. */
export const RECYCLABLE: Material[] = ['plastic', 'paper', 'glass', 'metal', 'cardboard']

export const MATERIAL_LABEL: Record<Material, string> = {
  plastic: 'Plastic',
  paper: 'Paper',
  glass: 'Glass',
  metal: 'Metal',
  cardboard: 'Cardboard',
  organic: 'Organic',
  other: 'Other',
}

export const MATERIAL_COLOUR: Record<Material, string> = {
  plastic: '#3B82F6',
  paper: '#C39A62',
  glass: '#5EAAA8',
  metal: '#9AA5B1',
  cardboard: '#A67C52',
  organic: '#64816C',
  other: '#6E6A60',
}

/** Mean item mass by material, kg. Representative of kerbside items. */
export const MATERIAL_MASS_KG: Record<Material, number> = {
  plastic: 0.04,
  paper: 0.09,
  glass: 0.35,
  metal: 0.08,
  cardboard: 0.22,
  organic: 0.25,
  other: 0.15,
}

/**
 * How readily each material is separated by established MRF technology.
 *
 * These are relative difficulty weights applied to the user's overall sorting
 * accuracy, reflecting the physics each technology exploits: eddy-current and
 * magnetic separation handle metal almost perfectly; optical NIR sorting works
 * well on rigid plastics and paper; glass fragments and mixed residual are the
 * hard cases. They are illustrative weights, not measured line performance.
 */
export const SEPARABILITY: Record<Material, number> = {
  metal: 1.0,
  cardboard: 0.95,
  paper: 0.9,
  plastic: 0.85,
  glass: 0.75,
  organic: 0.7,
  other: 0.45,
}

export interface CompositionProfile {
  id: number
  label: string
  /** Mass fractions, summing to 1. */
  fractions: Record<Material, number>
  source: string
}

/**
 * Compositions from World Bank "What a Waste 2.0" (Kaza, Yao, Bhada-Tata &
 * Van Woerden, 2018), Table 2.5 — by-mass global and income-group averages.
 * "Other" absorbs the published wood, rubber, leather and miscellaneous
 * categories. Cardboard is separated from the published paper-and-cardboard
 * figure using a conventional 40 % cardboard split, which is an assumption.
 */
export const COMPOSITION_PROFILES: CompositionProfile[] = [
  {
    id: 0,
    label: 'Global average municipal waste',
    fractions: { organic: 0.44, paper: 0.102, cardboard: 0.068, plastic: 0.12, glass: 0.05, metal: 0.04, other: 0.18 },
    source: 'World Bank, What a Waste 2.0 (2018), global average by mass.',
  },
  {
    id: 1,
    label: 'High-income municipal waste',
    fractions: { organic: 0.32, paper: 0.132, cardboard: 0.088, plastic: 0.13, glass: 0.05, metal: 0.06, other: 0.22 },
    source: 'World Bank, What a Waste 2.0 (2018), high-income country average by mass.',
  },
  {
    id: 2,
    label: 'Low-income municipal waste',
    fractions: { organic: 0.56, paper: 0.03, cardboard: 0.02, plastic: 0.07, glass: 0.03, metal: 0.02, other: 0.27 },
    source: 'World Bank, What a Waste 2.0 (2018), low-income country average by mass.',
  },
  {
    id: 3,
    label: 'Source-separated dry recyclables',
    fractions: { organic: 0.03, paper: 0.26, cardboard: 0.24, plastic: 0.24, glass: 0.11, metal: 0.09, other: 0.03 },
    source: 'Illustrative kerbside dry-recyclable stream after household separation. Not a published figure.',
  },
]

export function profileById(id: number): CompositionProfile {
  return COMPOSITION_PROFILES.find((profile) => profile.id === id) ?? COMPOSITION_PROFILES[0]
}

/** Belt length, metres. Fixed so the geometry matches the 3D scene. */
export const BELT_LENGTH_M = 12
/** Where items are classified, metres along the belt. */
export const CLASSIFIER_POSITION_M = 4
/** Where the first diverter sits, and the spacing between them. */
export const FIRST_DIVERTER_M = 6
export const DIVERTER_SPACING_M = 1.1

export interface BeltItem {
  id: number
  /** The item's true material. */
  material: Material
  /** Distance travelled along the belt, metres. */
  x: number
  massKg: number
  /** What the classifier decided. Null until it passes the classifier. */
  classifiedAs: Material | null
  /** Bin it was diverted into, or null while still on the belt. */
  divertedTo: Material | 'residual' | null
  /** Lateral offset for the 3D scene, −1..1. Deterministic. */
  lane: number
}

export interface WasteState {
  /** Simulated seconds elapsed. */
  seconds: number
  items: BeltItem[]
  nextItemId: number
  /** Accumulated fractional item arrivals. */
  spawnAccumulator: number
  prngState: number
  /** Seconds until each diverter is free again. */
  diverterBusyUntil: number[]
  /** Mass arriving on the belt, by true material. */
  inputKg: Record<Material, number>
  /** Mass landing in each bin, by the bin's material. */
  binKg: Record<Material, number>
  /** Mass landing in the correct bin. */
  correctKg: Record<Material, number>
  /** Mass landing in a bin it does not belong in. */
  misroutedKg: number
  /** Mass reaching the end of the belt without being diverted. */
  residualKg: number
  /** Items that passed a diverter while it was still busy. */
  missedByBusyDiverter: number
  totalItems: number
}

function emptyMaterialRecord(): Record<Material, number> {
  return { plastic: 0, paper: 0, glass: 0, metal: 0, cardboard: 0, organic: 0, other: 0 }
}

const PARAMETERS: ParameterSpec[] = [
  {
    key: 'beltSpeedMps',
    label: 'Conveyor speed',
    unit: 'm/s',
    min: 0,
    max: 3,
    step: 0.05,
    default: 0.6,
    decimals: 2,
    group: 'Line',
    note: 'Belt linear speed. Faster moves more material but leaves each diverter less time to act, so misses rise. Set to 0 to stop the belt.',
  },
  {
    key: 'arrivalRatePerMin',
    label: 'Feed rate',
    unit: 'items/min',
    min: 0,
    max: 400,
    step: 5,
    default: 90,
    decimals: 0,
    group: 'Line',
    note: 'Items placed on the belt per minute. Combined with the composition profile this sets the mass throughput.',
  },
  {
    key: 'compositionProfile',
    label: 'Feed composition',
    unit: '',
    min: 0,
    max: 3,
    step: 1,
    default: 1,
    group: 'Line',
    options: COMPOSITION_PROFILES.map((profile) => ({ value: profile.id, label: profile.label })),
    note: 'Published by-mass compositions from World Bank What a Waste 2.0, except the source-separated option which is illustrative.',
  },
  {
    key: 'diverterCount',
    label: 'Sorting effectors',
    unit: 'arms',
    min: 1,
    max: 5,
    step: 1,
    default: 3,
    decimals: 0,
    group: 'Sorting',
    note: 'Each effector is assigned one material and can handle one item at a time. More effectors cover more streams and miss fewer items.',
  },
  {
    key: 'sortingAccuracyPercent',
    label: 'Classification accuracy',
    unit: '%',
    min: 40,
    max: 100,
    step: 1,
    default: 88,
    decimals: 0,
    group: 'Sorting',
    note: 'Baseline hit rate, then weighted per material by how separable it physically is. This is a rule-based parameter you set — there is no trained classifier in this application.',
  },
  {
    key: 'diverterCycleSeconds',
    label: 'Effector cycle time',
    unit: 's',
    min: 0.2,
    max: 3,
    step: 0.1,
    default: 0.8,
    decimals: 1,
    group: 'Sorting',
    note: 'How long an effector is occupied per pick. An item arriving at a busy effector passes it and continues to residual.',
  },
  {
    key: 'contaminationPercent',
    label: 'Feed contamination',
    unit: '%',
    min: 0,
    max: 40,
    step: 1,
    default: 8,
    decimals: 0,
    group: 'Sorting',
    note: 'Share of items too soiled or composite to classify correctly regardless of accuracy. Reflects the real limit that contamination, not technology, usually sets on recovery.',
  },
  {
    key: 'seed',
    label: 'Run seed',
    unit: '',
    min: 1,
    max: 9999,
    step: 1,
    default: 1337,
    decimals: 0,
    group: 'Run',
    note: 'Seeds the deterministic generator for arrivals and classification. The same seed and parameters always produce exactly the same run.',
  },
]

const METRICS: MetricDefinition[] = [
  { key: 'throughputKgPerHour', label: 'Throughput', unit: 'kg/h', kind: 'model', decimals: 1, headline: true },
  { key: 'recoveryRatePercent', label: 'Material recovery rate', unit: '%', kind: 'model', decimals: 1, headline: true, note: 'Correctly binned recyclable mass ÷ recyclable mass in the feed. Computed from the simulated items, not assumed.' },
  { key: 'purityPercent', label: 'Output purity', unit: '%', kind: 'model', decimals: 1, headline: true, note: 'Correctly binned mass ÷ all binned mass. Low purity means contaminated bales, which depresses their market value or rejects them outright.' },
  { key: 'residualPercent', label: 'Sent to residual', unit: '%', kind: 'model', decimals: 1, headline: true, lowerIsBetter: true },
  { key: 'totalProcessedKg', label: 'Total mass processed', unit: 'kg', kind: 'model', decimals: 1 },
  { key: 'recoveredKg', label: 'Recyclables recovered', unit: 'kg', kind: 'model', decimals: 1 },
  { key: 'misroutedKg', label: 'Misrouted mass', unit: 'kg', kind: 'model', decimals: 1, lowerIsBetter: true },
  { key: 'residualKg', label: 'Residual mass', unit: 'kg', kind: 'model', decimals: 1, lowerIsBetter: true },
  { key: 'plasticKg', label: 'Plastic recovered', unit: 'kg', kind: 'model', decimals: 2 },
  { key: 'paperKg', label: 'Paper recovered', unit: 'kg', kind: 'model', decimals: 2 },
  { key: 'glassKg', label: 'Glass recovered', unit: 'kg', kind: 'model', decimals: 2 },
  { key: 'metalKg', label: 'Metal recovered', unit: 'kg', kind: 'model', decimals: 2 },
  { key: 'cardboardKg', label: 'Cardboard recovered', unit: 'kg', kind: 'model', decimals: 2 },
  { key: 'organicKg', label: 'Organic recovered', unit: 'kg', kind: 'model', decimals: 2 },
  { key: 'missedByBusyDiverter', label: 'Missed — effector busy', unit: 'items', kind: 'model', decimals: 0, lowerIsBetter: true, note: 'Items that reached an effector already occupied. This is the belt-speed trade-off made visible.' },
  { key: 'itemsProcessed', label: 'Items processed', unit: 'items', kind: 'model', decimals: 0 },
]

const SERIES: SeriesKey[] = [
  { key: 'recoveryRate', label: 'Recovery rate', unit: '%', colour: '#10B981' },
  { key: 'purity', label: 'Output purity', unit: '%', colour: '#3B82F6' },
  { key: 'cumulativeKg', label: 'Mass processed', unit: 'kg', colour: '#6E6A60', secondaryAxis: true },
  { key: 'residualKg', label: 'Residual mass', unit: 'kg', colour: '#C25E3A', secondaryAxis: true },
  { key: 'onBelt', label: 'Items on belt', unit: 'items', colour: '#C39A62' },
]

const PRESETS: ScenarioPreset[] = [
  {
    id: 'baseline-line',
    label: 'Standard line',
    kind: 'baseline',
    description: 'Three effectors, moderate belt speed, typical high-income feed with 8 % contamination.',
    overrides: { beltSpeedMps: 0.6, arrivalRatePerMin: 90, diverterCount: 3, sortingAccuracyPercent: 88, contaminationPercent: 8, compositionProfile: 1 },
  },
  {
    id: 'fast-belt',
    label: 'Belt sped up',
    kind: 'alternative',
    description: 'Double the belt speed to raise throughput. Watch what it does to misses and recovery.',
    overrides: { beltSpeedMps: 1.4, arrivalRatePerMin: 180, diverterCount: 3, sortingAccuracyPercent: 88, contaminationPercent: 8, compositionProfile: 1 },
  },
  {
    id: 'more-effectors',
    label: 'Five effectors',
    kind: 'alternative',
    description: 'More sorting capacity at the same speed, covering more material streams.',
    overrides: { beltSpeedMps: 0.6, arrivalRatePerMin: 90, diverterCount: 5, sortingAccuracyPercent: 88, contaminationPercent: 8, compositionProfile: 1 },
  },
  {
    id: 'clean-feed',
    label: 'Source-separated feed',
    kind: 'alternative',
    description: 'A clean dry-recyclable stream with 2 % contamination. The largest single lever on recovery is usually what goes in, not the machinery.',
    overrides: { beltSpeedMps: 0.6, arrivalRatePerMin: 90, diverterCount: 3, sortingAccuracyPercent: 88, contaminationPercent: 2, compositionProfile: 3 },
  },
  {
    id: 'optimised-line',
    label: 'Optimised facility',
    kind: 'optimised',
    description: 'Clean feed, five effectors, fast cycle time and high accuracy together.',
    overrides: { beltSpeedMps: 0.8, arrivalRatePerMin: 120, diverterCount: 5, sortingAccuracyPercent: 95, diverterCycleSeconds: 0.4, contaminationPercent: 2, compositionProfile: 3 },
  },
]

/** Which material each effector is assigned to, by count. Highest value first. */
export function diverterAssignments(count: number): Material[] {
  // Ordered by the value recovered per unit of effector time.
  const priority: Material[] = ['cardboard', 'plastic', 'metal', 'paper', 'glass']
  return priority.slice(0, Math.max(1, Math.min(count, priority.length)))
}

export function diverterPosition(index: number): number {
  return FIRST_DIVERTER_M + index * DIVERTER_SPACING_M
}

const TICK_SECONDS = 0.5

export interface WasteBaseline extends EngineBaseline {
  /** Nothing external feeds this engine; the field documents that honestly. */
  note: string
}

export const WASTE_BASELINE: WasteBaseline = {
  note: 'This engine takes no external data. The feed compositions are published World Bank figures; everything else is a parameter you set.',
  provenance: [
    'Feed composition from World Bank, What a Waste 2.0 (Kaza et al., 2018).',
    'No live data source and no trained classifier. All line behaviour is simulated from the parameters shown.',
  ],
  seededFromObservation: false,
}

export const wasteEngine: SimulationEngine<WasteState, WasteBaseline> = {
  id: 'waste',
  label: 'Materials recovery facility engine',
  tickHours: TICK_SECONDS / 3600,
  defaultDurationHours: 600 / 3600,
  timeUnit: 'seconds',
  parameters: PARAMETERS,
  metrics: METRICS,
  series: SERIES,
  presets: PRESETS,
  disclaimer:
    'A discrete-item conveyor model. There is no trained classifier in this application: classification is a rule-based draw against the accuracy you set, weighted by how separable each material physically is. It demonstrates how a sorting line behaves — the interaction of speed, effector count and feed quality — and makes no computer-vision claim whatsoever.',
  assumptions: [
    'Feed composition is a published by-mass average (World Bank, What a Waste 2.0), applied as arrival probabilities. A real facility sees large day-to-day variation around it.',
    'Mean item masses are representative kerbside values, not measurements of any particular stream.',
    'Per-material separability weights reflect the physics each sorting technology exploits — magnetic and eddy-current for metal, optical NIR for rigid plastics and paper — but are illustrative weights, not measured line performance.',
    'Each effector handles one item at a time, with a fixed cycle. An item arriving at a busy effector is missed and continues to residual.',
    'Contaminated items are assumed unclassifiable regardless of accuracy, which is why feed quality dominates recovery in practice.',
    'The model has no jams, no burst-outs, no screens or air classifiers, and no downstream baling or market rejection.',
    'Arrivals and classification outcomes come from a seeded generator, so the same parameters always produce exactly the same run.',
  ],

  init(params) {
    return {
      seconds: 0,
      items: [],
      nextItemId: 1,
      spawnAccumulator: 0,
      prngState: Math.floor(params.seed) >>> 0,
      diverterBusyUntil: new Array(5).fill(0),
      inputKg: emptyMaterialRecord(),
      binKg: emptyMaterialRecord(),
      correctKg: emptyMaterialRecord(),
      misroutedKg: 0,
      residualKg: 0,
      missedByBusyDiverter: 0,
      totalItems: 0,
    }
  },

  step(state, params, _baseline, tickHours) {
    const dt = tickHours * 3600
    const prng = createPrng(state.prngState)
    const profile = profileById(params.compositionProfile)
    const assignments = diverterAssignments(params.diverterCount)

    const items = state.items.map((item) => ({ ...item }))
    const inputKg = { ...state.inputKg }
    const binKg = { ...state.binKg }
    const correctKg = { ...state.correctKg }
    const diverterBusyUntil = [...state.diverterBusyUntil]

    let { misroutedKg, residualKg, missedByBusyDiverter, totalItems, nextItemId } = state
    const seconds = state.seconds + dt

    // ── Arrivals ─────────────────────────────────────────────────────────
    let spawnAccumulator = state.spawnAccumulator + (params.arrivalRatePerMin / 60) * dt
    while (spawnAccumulator >= 1) {
      spawnAccumulator -= 1
      const material = prng.weighted(
        MATERIALS as unknown as Material[],
        MATERIALS.map((key) => profile.fractions[key]),
      )
      const massKg = MATERIAL_MASS_KG[material] * prng.range(0.7, 1.3)
      items.push({
        id: nextItemId++,
        material,
        x: 0,
        massKg,
        classifiedAs: null,
        divertedTo: null,
        lane: prng.range(-1, 1),
      })
      inputKg[material] += massKg
      totalItems++
    }

    // ── Belt motion, classification and diversion ────────────────────────
    const remaining: BeltItem[] = []
    for (const item of items) {
      const previousX = item.x
      item.x += params.beltSpeedMps * dt

      // Classification happens once, as the item passes the station.
      if (item.classifiedAs === null && previousX < CLASSIFIER_POSITION_M && item.x >= CLASSIFIER_POSITION_M) {
        const contaminated = prng.next() < params.contaminationPercent / 100
        if (contaminated) {
          // A contaminated item is misread as something else, which is how
          // contamination poisons an output bale in a real facility.
          const wrongOptions = MATERIALS.filter((candidate) => candidate !== item.material)
          item.classifiedAs = wrongOptions[prng.int(0, wrongOptions.length - 1)]
        } else {
          const hitRate = (params.sortingAccuracyPercent / 100) * SEPARABILITY[item.material]
          if (prng.next() < hitRate) {
            item.classifiedAs = item.material
          } else {
            const wrongOptions = MATERIALS.filter((candidate) => candidate !== item.material)
            item.classifiedAs = wrongOptions[prng.int(0, wrongOptions.length - 1)]
          }
        }
      }

      // Diversion at the effector assigned to the item's predicted material.
      if (item.classifiedAs !== null && item.divertedTo === null) {
        const effectorIndex = assignments.indexOf(item.classifiedAs)
        if (effectorIndex >= 0) {
          const position = diverterPosition(effectorIndex)
          if (previousX < position && item.x >= position) {
            if (seconds >= diverterBusyUntil[effectorIndex]) {
              diverterBusyUntil[effectorIndex] = seconds + params.diverterCycleSeconds
              item.divertedTo = item.classifiedAs
              binKg[item.classifiedAs] += item.massKg
              if (item.classifiedAs === item.material) correctKg[item.material] += item.massKg
              else misroutedKg += item.massKg
            } else {
              missedByBusyDiverter++
            }
          }
        }
      }

      if (item.divertedTo !== null) {
        // Keep it briefly past the diverter so the scene can animate the pick.
        if (item.x < BELT_LENGTH_M + 1) remaining.push(item)
        continue
      }

      if (item.x >= BELT_LENGTH_M) {
        residualKg += item.massKg
        continue
      }
      remaining.push(item)
    }

    return {
      seconds,
      items: remaining,
      nextItemId,
      spawnAccumulator,
      prngState: prng.state,
      diverterBusyUntil,
      inputKg,
      binKg,
      correctKg,
      misroutedKg,
      residualKg,
      missedByBusyDiverter,
      totalItems,
    }
  },

  derive(state) {
    const totalInputKg = MATERIALS.reduce((sum, key) => sum + state.inputKg[key], 0)
    const recyclableInputKg = RECYCLABLE.reduce((sum, key) => sum + state.inputKg[key], 0)
    const correctRecyclableKg = RECYCLABLE.reduce((sum, key) => sum + state.correctKg[key], 0)
    const totalBinnedKg = MATERIALS.reduce((sum, key) => sum + state.binKg[key], 0)
    const totalCorrectKg = MATERIALS.reduce((sum, key) => sum + state.correctKg[key], 0)
    const hours = Math.max(state.seconds / 3600, 1e-9)

    return {
      throughputKgPerHour: totalInputKg / hours,
      recoveryRatePercent:
        recyclableInputKg > 0 ? (correctRecyclableKg / recyclableInputKg) * 100 : null,
      purityPercent: totalBinnedKg > 0 ? (totalCorrectKg / totalBinnedKg) * 100 : null,
      residualPercent: totalInputKg > 0 ? (state.residualKg / totalInputKg) * 100 : null,
      totalProcessedKg: totalInputKg,
      recoveredKg: totalBinnedKg,
      misroutedKg: state.misroutedKg,
      residualKg: state.residualKg,
      plasticKg: state.binKg.plastic,
      paperKg: state.binKg.paper,
      glassKg: state.binKg.glass,
      metalKg: state.binKg.metal,
      cardboardKg: state.binKg.cardboard,
      organicKg: state.binKg.organic,
      missedByBusyDiverter: state.missedByBusyDiverter,
      itemsProcessed: state.totalItems,
    }
  },

  sample(state) {
    const recyclableInputKg = RECYCLABLE.reduce((sum, key) => sum + state.inputKg[key], 0)
    const correctRecyclableKg = RECYCLABLE.reduce((sum, key) => sum + state.correctKg[key], 0)
    const totalBinnedKg = MATERIALS.reduce((sum, key) => sum + state.binKg[key], 0)
    const totalCorrectKg = MATERIALS.reduce((sum, key) => sum + state.correctKg[key], 0)
    const totalInputKg = MATERIALS.reduce((sum, key) => sum + state.inputKg[key], 0)

    return {
      t: Number(state.seconds.toFixed(1)),
      recoveryRate:
        recyclableInputKg > 0 ? Number(((correctRecyclableKg / recyclableInputKg) * 100).toFixed(2)) : null,
      purity: totalBinnedKg > 0 ? Number(((totalCorrectKg / totalBinnedKg) * 100).toFixed(2)) : null,
      cumulativeKg: Number(totalInputKg.toFixed(3)),
      residualKg: Number(state.residualKg.toFixed(3)),
      onBelt: state.items.filter((item) => item.divertedTo === null).length,
    } satisfies SeriesRow
  },

  explain(state, params) {
    const profile = profileById(params.compositionProfile)
    const recyclableInputKg = RECYCLABLE.reduce((sum, key) => sum + state.inputKg[key], 0)
    const correctRecyclableKg = RECYCLABLE.reduce((sum, key) => sum + state.correctKg[key], 0)
    const totalBinnedKg = MATERIALS.reduce((sum, key) => sum + state.binKg[key], 0)
    const totalCorrectKg = MATERIALS.reduce((sum, key) => sum + state.correctKg[key], 0)
    const assignments = diverterAssignments(params.diverterCount)
    const r = (value: number, decimals = 2) => value.toFixed(decimals)

    return [
      `Feed: ${params.arrivalRatePerMin} items/min drawn from "${profile.label}" (${profile.source})`,
      `Belt at ${params.beltSpeedMps} m/s; classifier at ${CLASSIFIER_POSITION_M} m; ${assignments.length} effector(s) from ${FIRST_DIVERTER_M} m at ${DIVERTER_SPACING_M} m spacing, assigned ${assignments.map((material) => MATERIAL_LABEL[material]).join(', ')}`,
      `Hit rate per material = ${params.sortingAccuracyPercent}% accuracy × separability weight (metal ${SEPARABILITY.metal}, plastic ${SEPARABILITY.plastic}, glass ${SEPARABILITY.glass}, other ${SEPARABILITY.other})`,
      `${params.contaminationPercent}% of items are contaminated and misclassify regardless of accuracy`,
      `Each effector is occupied ${params.diverterCycleSeconds} s per pick; ${state.missedByBusyDiverter} item(s) arrived at a busy effector and went to residual`,
      `Recovery rate = correctly binned recyclables ÷ recyclables in feed = ${r(correctRecyclableKg)} kg ÷ ${r(recyclableInputKg)} kg = ${recyclableInputKg > 0 ? r((correctRecyclableKg / recyclableInputKg) * 100, 1) : '—'}%`,
      `Purity = correctly binned ÷ all binned = ${r(totalCorrectKg)} kg ÷ ${r(totalBinnedKg)} kg = ${totalBinnedKg > 0 ? r((totalCorrectKg / totalBinnedKg) * 100, 1) : '—'}%`,
      `Residual = ${r(state.residualKg)} kg reached the end of the belt undiverted`,
    ]
  },

  elapsedHours(state) {
    return state.seconds / 3600
  },
}
