/**
 * Grid-based fire propagation — an educational cellular automaton.
 *
 * READ THIS BEFORE INTERPRETING ANY OUTPUT.
 *
 * This is a simplified, deterministic cellular automaton whose rate-of-spread
 * term borrows the *form* of the Rothermel (1972) surface fire model — a base
 * rate modified multiplicatively by wind, slope and fuel moisture — without
 * its physics. It has no reaction intensity, no fuel-bed depth, no packing
 * ratio, no heat of pre-ignition and no crown fire. It has not been calibrated
 * against, or validated on, a single real fire.
 *
 * It is here to let someone build intuition about how wind, moisture and fuel
 * continuity interact. It is NOT an operational wildfire prediction, and must
 * never be used as one. Real fire behaviour analysis uses FARSITE, FlamMap or
 * equivalent, run by trained analysts on surveyed fuel models.
 *
 * NASA FIRMS satellite detections are kept visually and numerically separate
 * from this simulation everywhere in the interface.
 *
 * Reference for the functional form only:
 *   Rothermel, R.C. (1972) "A mathematical model for predicting fire spread in
 *   wildland fuels", USDA Forest Service Research Paper INT-115.
 */

export type CellState = 0 | 1 | 2 | 3
/** Fuel present, not yet ignited. */
export const UNBURNED: CellState = 0
/** Heat accumulating; ignites when it crosses the threshold. */
export const HEATING: CellState = 1
/** Actively burning and spreading heat to neighbours. */
export const BURNING: CellState = 2
/** Fuel consumed; cannot re-ignite. */
export const BURNED: CellState = 3

export interface FireGrid {
  width: number
  height: number
  /** Cell edge length, metres. */
  cellSizeM: number
  state: Uint8Array
  /** Accumulated heat per cell, dimensionless 0–1. */
  heat: Float32Array
  /** Fuel load remaining per cell, 0–1. */
  fuel: Float32Array
  /** Burn duration remaining per cell, hours. */
  burnTime: Float32Array
}

export interface FireConditions {
  /** Air temperature, °C. */
  temperatureC: number
  /** Relative humidity, %. */
  relativeHumidityPercent: number
  /** Wind speed, km/h. */
  windSpeedKmh: number
  /** Wind direction in degrees, meteorological convention (direction FROM). */
  windDirectionDeg: number
  /** Fraction of cells carrying fuel at ignition, 0–1. */
  vegetationDensity: number
  /** Fine dead fuel moisture content, % of oven-dry weight. */
  fuelMoisturePercent: number
}

/**
 * Moisture damping. Spread falls steeply as fine fuels wet up and stops
 * entirely at the moisture of extinction.
 *
 * MOISTURE_OF_EXTINCTION is 30 % — a conventional value for grass and light
 * surface fuels. Above it, fine fuels will not carry a fire.
 */
export const MOISTURE_OF_EXTINCTION = 30

export function moistureDamping(fuelMoisturePercent: number): number {
  // At or above the moisture of extinction fire does not carry, full stop.
  // Returned as exact zero rather than letting the polynomial leave a
  // floating-point residue that would creep a fire through sodden fuel.
  if (fuelMoisturePercent >= MOISTURE_OF_EXTINCTION) return 0
  const ratio = Math.min(Math.max(fuelMoisturePercent, 0) / MOISTURE_OF_EXTINCTION, 1)
  // Rothermel's damping coefficient form: a cubic polynomial in the ratio.
  return Math.max(1 - 2.59 * ratio + 5.11 * ratio ** 2 - 3.52 * ratio ** 3, 0)
}

/**
 * Temperature effect on fine-fuel moisture.
 *
 * Warmer, drier air dries fine fuels. This returns the *effective* moisture
 * after adjusting the nominal value for current temperature and humidity —
 * which is how the shared temperature-anomaly lever reaches the fire model.
 *
 * The coefficients are a linear teaching approximation of the published fine
 * fuel moisture tables, not a fit to them.
 */
export const MOISTURE_PER_DEGREE = 0.18
export const MOISTURE_PER_HUMIDITY_POINT = 0.12

export function effectiveFuelMoisture(conditions: FireConditions): number {
  const temperatureEffect = -MOISTURE_PER_DEGREE * (conditions.temperatureC - 20)
  const humidityEffect = MOISTURE_PER_HUMIDITY_POINT * (conditions.relativeHumidityPercent - 40)
  return Math.min(Math.max(conditions.fuelMoisturePercent + temperatureEffect + humidityEffect, 1), 60)
}

/**
 * Wind factor along a given bearing.
 *
 * Spread is strongly enhanced downwind and suppressed upwind. The exponential
 * form with a directional cosine reproduces the characteristic elliptical
 * fire shape without solving for it.
 */
export const WIND_COEFFICIENT = 0.09

export function windFactor(conditions: FireConditions, spreadBearingDeg: number): number {
  // Meteorological convention: wind FROM 90° blows TOWARD 270°.
  const windToward = (conditions.windDirectionDeg + 180) % 360
  const angle = (((spreadBearingDeg - windToward) % 360) + 540) % 360 - 180
  const alignment = Math.cos((angle * Math.PI) / 180)
  return Math.exp(WIND_COEFFICIENT * conditions.windSpeedKmh * alignment)
}

/** Base rate of spread in still air with dry fuel, metres per hour. */
export const BASE_SPREAD_M_PER_HOUR = 40

/**
 * Rate of spread along a bearing, m/h.
 *
 *   ROS = R₀ · ξ_wind · ξ_moisture · ξ_fuel
 *
 * Each factor is dimensionless and documented above.
 */
export function rateOfSpread(
  conditions: FireConditions,
  spreadBearingDeg: number,
  cellFuel: number,
): number {
  const moisture = effectiveFuelMoisture(conditions)
  return (
    BASE_SPREAD_M_PER_HOUR *
    windFactor(conditions, spreadBearingDeg) *
    moistureDamping(moisture) *
    Math.max(cellFuel, 0)
  )
}

/** How long a cell burns once ignited, hours. Scales with fuel load. */
export const BURN_DURATION_HOURS = 1.5

export function createGrid(
  width: number,
  height: number,
  cellSizeM: number,
  vegetationDensity: number,
  seed: number,
): FireGrid {
  const size = width * height
  const grid: FireGrid = {
    width,
    height,
    cellSizeM,
    state: new Uint8Array(size),
    heat: new Float32Array(size),
    fuel: new Float32Array(size),
    burnTime: new Float32Array(size),
  }

  // Deterministic fuel field: value noise from the seed, thresholded by the
  // density setting. The same seed and density always give the same forest.
  let s = seed >>> 0
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  for (let i = 0; i < size; i++) {
    const roll = random()
    // Cells above the density threshold hold no fuel at all — this is what
    // creates the gaps that stop a fire, and why density matters so much.
    grid.fuel[i] = roll < vegetationDensity ? 0.5 + random() * 0.5 : 0
  }
  return grid
}

export function igniteAt(grid: FireGrid, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return
  const index = y * grid.width + x
  if (grid.fuel[index] <= 0) return
  grid.state[index] = BURNING
  grid.burnTime[index] = BURN_DURATION_HOURS * grid.fuel[index]
}

/** Bearings of the eight neighbours, in degrees. */
const NEIGHBOURS: { dx: number; dy: number; bearing: number; distance: number }[] = [
  { dx: 0, dy: -1, bearing: 0, distance: 1 },
  { dx: 1, dy: -1, bearing: 45, distance: Math.SQRT2 },
  { dx: 1, dy: 0, bearing: 90, distance: 1 },
  { dx: 1, dy: 1, bearing: 135, distance: Math.SQRT2 },
  { dx: 0, dy: 1, bearing: 180, distance: 1 },
  { dx: -1, dy: 1, bearing: 225, distance: Math.SQRT2 },
  { dx: -1, dy: 0, bearing: 270, distance: 1 },
  { dx: -1, dy: -1, bearing: 315, distance: Math.SQRT2 },
]

export interface FireStepResult {
  grid: FireGrid
  /** Cells that ignited during this step. */
  newlyIgnited: number
  burningCount: number
  burnedCount: number
  unburnedFuelCount: number
}

/**
 * Advance the fire by `hours`.
 *
 * A burning cell transfers heat to each neighbour at a rate proportional to
 * the rate of spread along that bearing, divided by the distance. When a
 * neighbour's accumulated heat reaches 1 it ignites. Entirely deterministic:
 * no randomness enters after the fuel field is generated.
 */
export function stepFire(grid: FireGrid, conditions: FireConditions, hours: number): FireStepResult {
  const { width, height, cellSizeM } = grid
  const nextState = new Uint8Array(grid.state)
  const nextHeat = new Float32Array(grid.heat)
  const nextFuel = new Float32Array(grid.fuel)
  const nextBurnTime = new Float32Array(grid.burnTime)

  let newlyIgnited = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (grid.state[index] !== BURNING) continue

      // Consume fuel and count down the burn.
      nextBurnTime[index] = grid.burnTime[index] - hours
      nextFuel[index] = Math.max(grid.fuel[index] - hours / BURN_DURATION_HOURS, 0)
      if (nextBurnTime[index] <= 0) {
        nextState[index] = BURNED
        nextFuel[index] = 0
      }

      for (const neighbour of NEIGHBOURS) {
        const nx = x + neighbour.dx
        const ny = y + neighbour.dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const nIndex = ny * width + nx
        if (grid.state[nIndex] !== UNBURNED && grid.state[nIndex] !== HEATING) continue
        if (grid.fuel[nIndex] <= 0) continue

        const ros = rateOfSpread(conditions, neighbour.bearing, grid.fuel[nIndex])
        // Fraction of the inter-cell distance the front covers this step.
        const advance = (ros * hours) / (cellSizeM * neighbour.distance)
        nextHeat[nIndex] += advance

        if (nextHeat[nIndex] >= 1 && nextState[nIndex] !== BURNING) {
          nextState[nIndex] = BURNING
          nextBurnTime[nIndex] = BURN_DURATION_HOURS * grid.fuel[nIndex]
          newlyIgnited++
        } else if (nextState[nIndex] === UNBURNED && nextHeat[nIndex] > 0.05) {
          nextState[nIndex] = HEATING
        }
      }
    }
  }

  const next: FireGrid = {
    width,
    height,
    cellSizeM,
    state: nextState,
    heat: nextHeat,
    fuel: nextFuel,
    burnTime: nextBurnTime,
  }

  let burningCount = 0
  let burnedCount = 0
  let unburnedFuelCount = 0
  for (let i = 0; i < nextState.length; i++) {
    if (nextState[i] === BURNING) burningCount++
    else if (nextState[i] === BURNED) burnedCount++
    else if (nextFuel[i] > 0) unburnedFuelCount++
  }

  return { grid: next, newlyIgnited, burningCount, burnedCount, unburnedFuelCount }
}

/** Area represented by a count of cells, hectares. */
export function cellsToHectares(cells: number, cellSizeM: number): number {
  return (cells * cellSizeM * cellSizeM) / 10_000
}

export const FIRE_MODEL_DISCLAIMER =
  'This is a simplified, deterministic cellular automaton built for teaching. Its rate-of-spread term borrows the functional form of the Rothermel surface fire model — a base rate modified by wind, moisture and fuel — but not its physics, and it has never been calibrated against a real fire. It makes no operational prediction. Satellite fire detections shown elsewhere in this module are real measurements and are kept entirely separate from it.'
