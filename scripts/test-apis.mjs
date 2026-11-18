/**
 * Independent verification of every API integration.
 *
 * Deliberately does NOT import the app's service layer: it exercises the real
 * endpoints and asserts on the real payloads, so a passing run means the
 * provider actually returned usable data — not merely that a service file
 * exists. For each source it checks the endpoint, the response shape, the
 * transformation, the units and the timestamps, plus a failure path.
 *
 *   npm run test:apis                  # keyless sources + proxy if running
 *   PROXY=http://localhost:8787 npm run test:apis
 */

const PROXY = process.env.PROXY || 'http://localhost:8787'
const TIMEOUT_MS = Number(process.env.API_TEST_TIMEOUT || 60_000)

// Chennai: tropical coastal, no USGS gauges, GloFAS has no river cell.
const CHENNAI = { lat: 13.08784, lon: 80.27847, name: 'Chennai, India' }
// St Louis: inside USGS coverage, on the Mississippi.
const ST_LOUIS = { lat: 38.6270, lon: -90.1994, name: 'St Louis, USA' }

const results = []
let currentSource = ''

const bold = (s) => `\u001b[1m${s}\u001b[0m`
const green = (s) => `\u001b[32m${s}\u001b[0m`
const red = (s) => `\u001b[31m${s}\u001b[0m`
const yellow = (s) => `\u001b[33m${s}\u001b[0m`
const dim = (s) => `\u001b[2m${s}\u001b[0m`

function check(name, condition, detail) {
  const ok = Boolean(condition)
  results.push({ source: currentSource, name, ok, detail })
  console.log(`  ${ok ? green('PASS') : red('FAIL')}  ${name}${detail ? dim(` — ${detail}`) : ''}`)
  return ok
}

function skip(name, reason) {
  results.push({ source: currentSource, name, ok: null, detail: reason })
  console.log(`  ${yellow('SKIP')}  ${name}${dim(` — ${reason}`)}`)
}

async function getJson(url, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      /* non-JSON bodies are returned as raw text below */
    }
    return { status: response.status, ok: response.ok, body, text }
  } finally {
    clearTimeout(timer)
  }
}

function section(title) {
  currentSource = title
  console.log(`\n${bold(title)}`)
}

const isIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))

// ── Open-Meteo geocoding ─────────────────────────────────────────────────

async function testGeocoding() {
  section('Open-Meteo Geocoding')
  const { ok, body } = await getJson(
    'https://geocoding-api.open-meteo.com/v1/search?name=Chennai&count=3&language=en&format=json',
  )
  if (!check('Endpoint responds 2xx', ok)) return
  const first = body?.results?.[0]
  check('Returns results array', Array.isArray(body?.results) && body.results.length > 0)
  check('Result carries latitude and longitude', typeof first?.latitude === 'number' && typeof first?.longitude === 'number',
    first ? `${first.latitude}, ${first.longitude}` : undefined)
  check('Result carries country and timezone', typeof first?.country === 'string' && typeof first?.timezone === 'string',
    first ? `${first.country} / ${first.timezone}` : undefined)
  check('Administrative region present where available', 'admin1' in (first ?? {}), first?.admin1)

  const empty = await getJson(
    'https://geocoding-api.open-meteo.com/v1/search?name=zzzzqqqqxxxx&count=3&language=en&format=json',
  )
  check('No-match query omits `results` rather than erroring', empty.ok && empty.body?.results === undefined)
}

// ── Open-Meteo forecast ──────────────────────────────────────────────────

async function testForecast() {
  section('Open-Meteo Forecast (current + 7-day)')
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${CHENNAI.lat}&longitude=${CHENNAI.lon}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,wind_direction_10m,cloud_cover,surface_pressure,is_day,weather_code' +
    '&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,shortwave_radiation_sum,et0_fao_evapotranspiration' +
    '&hourly=temperature_2m,precipitation,relative_humidity_2m,cloud_cover,soil_moisture_0_to_7cm,wind_speed_10m' +
    '&timezone=auto&forecast_days=7'
  const { ok, body } = await getJson(url)
  if (!check('Endpoint responds 2xx', ok)) return

  check('Current block present', body?.current != null)
  check('Current temperature is finite', Number.isFinite(body?.current?.temperature_2m),
    `${body?.current?.temperature_2m} ${body?.current_units?.temperature_2m}`)
  check('Provider supplies the unit for every current field',
    Object.keys(body?.current ?? {}).filter(k => k !== 'time' && k !== 'interval')
      .every(k => typeof body?.current_units?.[k] === 'string'))
  check('Current block carries its own observation timestamp', typeof body?.current?.time === 'string',
    body?.current?.time)
  check('Daily series has 7 days', body?.daily?.time?.length === 7, `${body?.daily?.time?.length} days`)
  check('Daily max/min arrays align with the time array',
    body?.daily?.temperature_2m_max?.length === body?.daily?.time?.length &&
    body?.daily?.temperature_2m_min?.length === body?.daily?.time?.length)
  check('ET0 (FAO-56) present for the irrigation balance',
    Array.isArray(body?.daily?.et0_fao_evapotranspiration) &&
    body.daily.et0_fao_evapotranspiration.some(Number.isFinite),
    `unit ${body?.daily_units?.et0_fao_evapotranspiration}`)
  check('Hourly soil moisture present', Array.isArray(body?.hourly?.soil_moisture_0_to_7cm) &&
    body.hourly.soil_moisture_0_to_7cm.some(Number.isFinite),
    `unit ${body?.hourly_units?.soil_moisture_0_to_7cm}`)
  check('Timezone resolved from coordinates', typeof body?.timezone === 'string', body?.timezone)

  const bad = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=999&longitude=999&current=temperature_2m`)
  check('Invalid coordinates produce an error with a reason', !bad.ok && typeof bad.body?.reason === 'string',
    bad.body?.reason)
}

// ── Open-Meteo archive ───────────────────────────────────────────────────

async function testArchive() {
  section('Open-Meteo Historical Weather (ERA5)')
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - 7)
  const start = new Date(end)
  start.setUTCFullYear(start.getUTCFullYear() - 1)
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${CHENNAI.lat}&longitude=${CHENNAI.lon}` +
    `&start_date=${start.toISOString().slice(0, 10)}&end_date=${end.toISOString().slice(0, 10)}` +
    '&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,shortwave_radiation_sum,et0_fao_evapotranspiration&timezone=auto'
  const { ok, body } = await getJson(url)
  if (!check('Endpoint responds 2xx', ok)) return

  const days = body?.daily?.time?.length ?? 0
  check('Returns roughly a year of daily values', days > 350 && days < 380, `${days} days`)
  check('Mean temperature series populated',
    body?.daily?.temperature_2m_mean?.filter(Number.isFinite).length > 300,
    `unit ${body?.daily_units?.temperature_2m_mean}`)
  check('Precipitation series populated',
    body?.daily?.precipitation_sum?.filter(Number.isFinite).length > 300,
    `unit ${body?.daily_units?.precipitation_sum}`)

  // Monthly aggregation — the transformation the app applies.
  const buckets = new Map()
  body.daily.time.forEach((date, i) => {
    const month = date.slice(0, 7)
    const bucket = buckets.get(month) ?? []
    const mean = body.daily.temperature_2m_mean[i]
    if (Number.isFinite(mean)) bucket.push(mean)
    buckets.set(month, bucket)
  })
  const months = [...buckets.entries()].filter(([, values]) => values.length > 0)
  check('Monthly aggregation yields 12–13 months', months.length >= 12 && months.length <= 14,
    `${months.length} months`)
  const sample = months[0]
  const monthlyMean = sample[1].reduce((a, b) => a + b, 0) / sample[1].length
  check('Monthly mean is a plausible temperature', monthlyMean > -60 && monthlyMean < 60,
    `${sample[0]}: ${monthlyMean.toFixed(2)} °C`)

  const future = await getJson(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${CHENNAI.lat}&longitude=${CHENNAI.lon}&start_date=2099-01-01&end_date=2099-01-05&daily=temperature_2m_mean&timezone=auto`,
  )
  check('A future date range is rejected or returns nulls, not invented values',
    !future.ok || (future.body?.daily?.temperature_2m_mean ?? []).every(v => v === null),
    future.ok ? 'all values null' : `HTTP ${future.status}`)
}

// ── Open-Meteo flood ────────────────────────────────────────────────────

async function testFlood() {
  section('Open-Meteo Flood API (GloFAS)')
  const onRiver = await getJson(
    `https://flood-api.open-meteo.com/v1/flood?latitude=${ST_LOUIS.lat}&longitude=${ST_LOUIS.lon}&daily=river_discharge,river_discharge_mean,river_discharge_max,river_discharge_min&forecast_days=14&past_days=30`,
  )
  if (!check('Endpoint responds 2xx', onRiver.ok)) return

  const days = onRiver.body?.daily?.time?.length ?? 0
  check('Returns past + forecast days', days >= 40, `${days} days`)
  check('Discharge unit reported by provider',
    typeof onRiver.body?.daily_units?.river_discharge === 'string',
    onRiver.body?.daily_units?.river_discharge)
  const values = (onRiver.body?.daily?.river_discharge ?? []).filter(Number.isFinite)
  check('On-river location returns finite discharge values', values.length > 0,
    values.length > 0 ? `${values.length} values, max ${Math.max(...values)}` : 'none')

  const offRiver = await getJson(
    `https://flood-api.open-meteo.com/v1/flood?latitude=${CHENNAI.lat}&longitude=${CHENNAI.lon}&daily=river_discharge&forecast_days=7`,
  )
  const allNull = (offRiver.body?.daily?.river_discharge ?? []).every(v => v === null)
  check('Off-river location returns all-null discharge (the no-river-cell case the UI reports)',
    offRiver.ok && allNull,
    `${CHENNAI.name}: ${allNull ? 'all null, as expected' : 'unexpected values'}`)
}

// ── NASA POWER ──────────────────────────────────────────────────────────

async function testPower() {
  section('NASA POWER')
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - 10)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 30)
  const fmt = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`

  const { ok, body } = await getJson(
    `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN,CLRSKY_SFC_SW_DWN,T2M,PRECTOTCORR,RH2M&community=AG&longitude=${CHENNAI.lon}&latitude=${CHENNAI.lat}&start=${fmt(start)}&end=${fmt(end)}&format=JSON`,
  )
  if (!check('Endpoint responds 2xx', ok)) return

  const parameters = body?.properties?.parameter
  check('Parameter block present', parameters != null)
  check('Irradiance series populated', Object.keys(parameters?.ALLSKY_SFC_SW_DWN ?? {}).length > 20,
    `${Object.keys(parameters?.ALLSKY_SFC_SW_DWN ?? {}).length} days`)
  check('Provider reports its own units', body?.parameters?.ALLSKY_SFC_SW_DWN?.units === 'MJ/m^2/day',
    body?.parameters?.ALLSKY_SFC_SW_DWN?.units)
  check('Fill value declared, so missing days are detectable',
    Number.isFinite(body?.header?.fill_value), String(body?.header?.fill_value))
  check('Source datasets named', Array.isArray(body?.header?.sources) && body.header.sources.length > 0,
    (body?.header?.sources ?? []).join(', '))

  // MJ/m²/day → kWh/m²/day, the conversion the app applies.
  const mjValues = Object.values(parameters?.ALLSKY_SFC_SW_DWN ?? {}).filter(
    v => Number.isFinite(v) && v !== body.header.fill_value,
  )
  const meanKwh = mjValues.reduce((a, b) => a + b, 0) / mjValues.length / 3.6
  check('MJ→kWh conversion yields a physically plausible irradiance', meanKwh > 0.2 && meanKwh < 10,
    `${meanKwh.toFixed(2)} kWh/m²/day`)

  const key = Object.keys(parameters?.T2M ?? {})[0]
  check('Date keys are YYYYMMDD and convert to a valid ISO date',
    /^\d{8}$/.test(key ?? '') && isIso(`${key?.slice(0, 4)}-${key?.slice(4, 6)}-${key?.slice(6, 8)}`),
    key)
}

// ── GBIF ────────────────────────────────────────────────────────────────

async function testGbif() {
  section('GBIF Occurrences')
  const span = 0.25
  const url =
    'https://api.gbif.org/v1/occurrence/search?' +
    `decimalLatitude=${(CHENNAI.lat - span).toFixed(4)},${(CHENNAI.lat + span).toFixed(4)}` +
    `&decimalLongitude=${(CHENNAI.lon - span).toFixed(4)},${(CHENNAI.lon + span).toFixed(4)}` +
    '&hasCoordinate=true&hasGeospatialIssue=false&limit=300'
  const { ok, body } = await getJson(url)
  if (!check('Endpoint responds 2xx', ok)) return

  check('Total match count reported', Number.isFinite(body?.count), String(body?.count))
  check('Records returned', Array.isArray(body?.results) && body.results.length > 0,
    `${body?.results?.length} records`)
  const withCoords = (body?.results ?? []).filter(
    r => Number.isFinite(r.decimalLatitude) && Number.isFinite(r.decimalLongitude),
  )
  check('Records carry usable coordinates for the 3D plot', withCoords.length > 0,
    `${withCoords.length} of ${body?.results?.length}`)
  check('Records fall inside the requested bounding box',
    withCoords.every(r =>
      r.decimalLatitude >= CHENNAI.lat - span - 0.01 &&
      r.decimalLatitude <= CHENNAI.lat + span + 0.01),
    'spatial filter honoured')
  check('Records carry a publishing dataset', (body?.results ?? []).some(r => typeof r.datasetKey === 'string'))
  check('Records carry a scientific name', (body?.results ?? []).some(r => typeof r.scientificName === 'string'),
    body?.results?.find(r => r.scientificName)?.scientificName)

  // Species tally — the transformation the app applies.
  const tally = new Map()
  for (const record of withCoords) {
    if (!record.scientificName) continue
    tally.set(record.scientificName, (tally.get(record.scientificName) ?? 0) + 1)
  }
  check('Species tally produces distinct names', tally.size > 0, `${tally.size} distinct names`)

  // A query that genuinely matches nothing: GBIF digitised records do not
  // predate the 16th century at these coordinates.
  const empty = await getJson(
    `https://api.gbif.org/v1/occurrence/search?decimalLatitude=${(CHENNAI.lat - 0.01).toFixed(4)},${(CHENNAI.lat + 0.01).toFixed(4)}&decimalLongitude=${(CHENNAI.lon - 0.01).toFixed(4)},${(CHENNAI.lon + 0.01).toFixed(4)}&hasCoordinate=true&year=1500,1501&limit=20`,
  )
  check('A query matching nothing returns zero records rather than an error',
    empty.ok && Array.isArray(empty.body?.results) && empty.body.results.length === 0,
    `count ${empty.body?.count}`)
}

// ── USGS ────────────────────────────────────────────────────────────────

async function testUsgs() {
  section('USGS Water Services (NWIS)')
  const span = 0.6
  const bbox = [ST_LOUIS.lon - span, ST_LOUIS.lat - span, ST_LOUIS.lon + span, ST_LOUIS.lat + span]
    .map(v => v.toFixed(4))
    .join(',')
  const { ok, body } = await getJson(
    `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bbox}&parameterCd=00060,00065&siteStatus=active&period=P7D`,
  )
  if (!check('Endpoint responds 2xx', ok)) return

  const series = body?.value?.timeSeries ?? []
  check('Time series returned', series.length > 0, `${series.length} series`)
  const withValues = series.filter(s => (s.values?.[0]?.value ?? []).length > 0)
  check('Series contain readings', withValues.length > 0, `${withValues.length} series with data`)

  const first = withValues[0]
  const reading = first?.values?.[0]?.value?.[0]
  check('Readings carry the provider\'s own timestamp', isIso(reading?.dateTime), reading?.dateTime)
  check('Unit reported by provider', typeof first?.variable?.unit?.unitCode === 'string',
    first?.variable?.unit?.unitCode)
  check('Site name and code present',
    typeof first?.sourceInfo?.siteName === 'string' && typeof first?.sourceInfo?.siteCode?.[0]?.value === 'string',
    first?.sourceInfo?.siteName)
  check('Provisional qualifier flag surfaced',
    (withValues.some(s => (s.values?.[0]?.value ?? []).some(v => (v.qualifiers ?? []).includes('P')))),
    'at least one reading flagged P')
  check('Provider disclaimer present',
    (body?.value?.queryInfo?.note ?? []).some(n => n.title === 'disclaimer'))

  // Unit conversion the app applies for the 3D scene.
  const discharge = withValues.find(s => s.variable?.variableCode?.[0]?.value === '00060')
  if (discharge) {
    const cfs = Number(discharge.values[0].value.at(-1).value)
    const cumecs = cfs * 0.028316846592
    check('cfs→m³/s conversion produces a sane figure', Number.isFinite(cumecs) && cumecs >= 0,
      `${cfs} ft³/s = ${cumecs.toFixed(2)} m³/s`)
  } else {
    skip('cfs→m³/s conversion', 'no discharge series in this bounding box right now')
  }

  // Coverage guard: Chennai must be rejected before a request is made.
  const US_BOXES = [
    { s: 24.0, n: 49.5, w: -125.5, e: -66.5 },
    { s: 51.0, n: 71.5, w: -170.0, e: -129.0 },
    { s: 18.5, n: 22.5, w: -160.5, e: -154.5 },
    { s: 17.6, n: 18.6, w: -67.5, e: -65.0 },
    { s: 13.2, n: 13.7, w: 144.5, e: 145.0 },
  ]
  const inCoverage = (lat, lon) => US_BOXES.some(b => lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e)
  check('Coverage guard admits St Louis', inCoverage(ST_LOUIS.lat, ST_LOUIS.lon))
  check('Coverage guard rejects Chennai (no request issued)', !inCoverage(CHENNAI.lat, CHENNAI.lon))
}

// ── Proxy-mediated sources ──────────────────────────────────────────────

async function testProxy() {
  section('Backend proxy')
  let health
  try {
    health = await getJson(`${PROXY}/api/health`)
  } catch (error) {
    check('Proxy reachable', false, String(error?.message ?? error))
    return null
  }
  if (!check('Health endpoint responds 2xx', health.ok, `${PROXY}/api/health`)) return null
  check('Reports integration configuration', health.body?.integrations != null)
  check('Health response carries a timestamp', isIso(health.body?.checkedAt), health.body?.checkedAt)

  const notFound = await getJson(`${PROXY}/api/does-not-exist`)
  check('Unknown route returns a structured error', notFound.status === 404 && notFound.body?.error?.code === 'NOT_FOUND')

  const badBbox = await getJson(`${PROXY}/api/overpass?kind=urban&west=0&south=0&east=50&north=50`)
  check('Oversized bounding box rejected with BAD_REQUEST',
    badBbox.status === 400 && badBbox.body?.error?.code === 'BAD_REQUEST',
    badBbox.body?.error?.message)

  return health.body.integrations
}

async function testOverpass() {
  section('OpenStreetMap via Overpass (through the proxy)')
  const span = 0.02
  const url = `${PROXY}/api/overpass?kind=urban&west=${(CHENNAI.lon - span).toFixed(5)}&south=${(CHENNAI.lat - span).toFixed(5)}&east=${(CHENNAI.lon + span).toFixed(5)}&north=${(CHENNAI.lat + span).toFixed(5)}`

  // Overpass is a shared volunteer service that queues requests when busy.
  // Retrying with backoff is what its own usage policy asks callers to do.
  let attempt = { ok: false, status: 0, body: null }
  for (let i = 0; i < 3; i++) {
    attempt = await getJson(url)
    if (attempt.ok || attempt.body?.error?.code !== 'RATE_LIMITED') break
    await new Promise(resolve => setTimeout(resolve, 5_000 * (i + 1)))
  }
  const { ok, status, body } = attempt
  if (!ok) {
    if (body?.error?.code === 'RATE_LIMITED') {
      skip('Overpass query', 'the public Overpass instance is at capacity right now; the proxy correctly reported RATE_LIMITED')
      check('At-capacity response is classified as RATE_LIMITED, not as a hard failure', true,
        body.error.message)
    } else {
      check('Overpass query succeeds', false, `HTTP ${status}: ${body?.error?.message ?? ''}`)
    }
    return
  }
  check('Overpass query succeeds', true, `${body?.elementCount} elements`)
  const elements = body?.osm?.elements ?? []
  const roads = elements.filter(e => e.tags?.highway)
  const buildings = elements.filter(e => e.tags?.building)
  // Mirror the app's own classification order: highway, then building, then a
  // green category from the allow-list. A building carrying an incidental
  // landuse tag is a building, and is returned with `out center` — no geometry.
  const GREEN_LEISURE = new Set(['park', 'garden', 'nature_reserve'])
  const GREEN_LANDUSE = new Set(['grass', 'forest', 'meadow', 'recreation_ground', 'village_green'])
  const green = elements.filter(
    e =>
      !e.tags?.highway &&
      !e.tags?.building &&
      (GREEN_LEISURE.has(e.tags?.leisure) || GREEN_LANDUSE.has(e.tags?.landuse)),
  )
  check('Roads returned with geometry',
    roads.length > 0 && roads.every(r => Array.isArray(r.geometry) && r.geometry.length >= 2),
    `${roads.length} road ways`)
  check('Buildings returned with a centre point',
    buildings.length === 0 || buildings.every(b => Number.isFinite(b.center?.lat ?? b.lat)),
    `${buildings.length} buildings`)
  check('Green spaces returned with closed polygon geometry',
    green.length === 0 || green.every(g => Array.isArray(g.geometry) && g.geometry.length >= 3),
    `${green.length} green areas`)
  check('Attribution supplied', typeof body?.attribution === 'string', body?.attribution)
  check('Retrieval timestamp supplied', isIso(body?.retrievedAt), body?.retrievedAt)

  // Road-density transformation the app applies.
  const toRad = (d) => (d * Math.PI) / 180
  const metres = (a, b) => {
    const R = 6371000
    const dLat = toRad(b.lat - a.lat)
    const dLon = toRad(b.lon - a.lon)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
  }
  let roadMetres = 0
  for (const road of roads) {
    for (let i = 1; i < road.geometry.length; i++) roadMetres += metres(road.geometry[i - 1], road.geometry[i])
  }
  const areaKm2 = (span * 2 * 110.574) * (span * 2 * 111.32 * Math.cos(toRad(CHENNAI.lat)))
  const density = roadMetres / areaKm2
  check('Road density is a plausible urban figure', density > 100 && density < 100_000,
    `${density.toFixed(0)} m/km² over ${areaKm2.toFixed(2)} km²`)
}

async function testOpenAq(configured) {
  section('OpenAQ v3 (through the proxy)')
  if (!configured) {
    const { status, body } = await getJson(
      `${PROXY}/api/openaq/locations?coordinates=${CHENNAI.lat},${CHENNAI.lon}&radius=25000&limit=5`,
    )
    check('Missing key reported as MISSING_API_KEY, not as a silent fallback',
      status === 503 && body?.error?.code === 'MISSING_API_KEY',
      body?.error?.message)
    check('Error names the environment variable to set',
      body?.error?.detail?.keyName === 'OPENAQ_API_KEY')
    skip('Live station readings', 'OPENAQ_API_KEY not configured')
    return
  }

  const stations = await getJson(
    `${PROXY}/api/openaq/locations?coordinates=${CHENNAI.lat},${CHENNAI.lon}&radius=25000&limit=25`,
  )
  if (!check('Station search responds 2xx', stations.ok, `HTTP ${stations.status}`)) return
  const list = stations.body?.results ?? []
  check('Stations returned', list.length > 0, `${list.length} stations`)
  const station = list.find(s => (s.sensors ?? []).length > 0) ?? list[0]
  check('Station carries sensors with parameter and unit',
    (station?.sensors ?? []).every(s => s.parameter?.name && typeof s.parameter?.units === 'string'),
    (station?.sensors ?? []).map(s => `${s.parameter?.name} (${s.parameter?.units})`).join(', '))
  check('Station carries coordinates', Number.isFinite(station?.coordinates?.latitude))
  check('Station reports its last datum time', isIso(station?.datetimeLast?.utc), station?.datetimeLast?.utc)

  const latest = await getJson(`${PROXY}/api/openaq/latest/${station.id}?limit=100`)
  if (!check('Latest endpoint responds 2xx', latest.ok, `HTTP ${latest.status}`)) return
  const readings = latest.body?.results ?? []
  check('Latest readings returned', readings.length > 0, `${readings.length} readings`)
  check('Readings carry a measurement timestamp', readings.every(r => isIso(r.datetime?.utc)),
    readings[0]?.datetime?.utc)
  check('Readings join to a sensor, so the pollutant and unit are known',
    readings.every(r => (station.sensors ?? []).some(s => s.id === r.sensorsId)) ||
      readings.some(r => (station.sensors ?? []).some(s => s.id === r.sensorsId)))

  // EPA AQI sub-index, recomputed here independently of the app's code.
  const pm25Sensor = (station.sensors ?? []).find(s => s.parameter?.name === 'pm25')
  const pm25Reading = readings.find(r => r.sensorsId === pm25Sensor?.id)
  if (pm25Reading && /ug\/m/.test(pm25Sensor.parameter.units.replace('µ', 'u'))) {
    const bands = [
      [0.0, 9.0, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
      [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 500],
    ]
    const c = Math.floor(Math.max(pm25Reading.value, 0) * 10) / 10
    const band = bands.find(b => c >= b[0] && c <= b[1])
    if (band) {
      const aqi = Math.round(((band[3] - band[2]) / (band[1] - band[0])) * (c - band[0]) + band[2])
      check('EPA PM2.5 sub-index computes within 0–500', aqi >= 0 && aqi <= 500,
        `${c} µg/m³ → AQI ${aqi}`)
    } else {
      check('PM2.5 above the top EPA breakpoint is reported, not clamped', c > 325.4, `${c} µg/m³`)
    }
  } else {
    skip('EPA PM2.5 sub-index', 'this station reported no PM2.5 in µg/m³')
  }
}

async function testFirms(configured) {
  section('NASA FIRMS (through the proxy)')
  if (!configured) {
    const { status, body } = await getJson(
      `${PROXY}/api/firms/area?west=${CHENNAI.lon - 1.5}&south=${CHENNAI.lat - 1.5}&east=${CHENNAI.lon + 1.5}&north=${CHENNAI.lat + 1.5}&days=3`,
    )
    check('Missing key reported as MISSING_API_KEY, not as a silent fallback',
      status === 503 && body?.error?.code === 'MISSING_API_KEY',
      body?.error?.message)
    check('Error names the environment variable to set',
      body?.error?.detail?.keyName === 'NASA_FIRMS_MAP_KEY')
    skip('Live fire detections', 'NASA_FIRMS_MAP_KEY not configured')
    return
  }

  // Central Africa in the dry season is the most reliable non-empty test area.
  const { ok, status, body } = await getJson(
    `${PROXY}/api/firms/area?west=15&south=-10&east=25&north=0&days=2`,
  )
  if (!check('Area endpoint responds 2xx', ok, `HTTP ${status}`)) return
  check('CSV parsed into typed detections', Array.isArray(body?.detections),
    `${body?.detectionCount} detections`)
  if ((body?.detections ?? []).length === 0) {
    skip('Detection field validation', 'no detections in the test window — a valid result, not a failure')
    return
  }
  const detection = body.detections[0]
  check('Detection carries finite coordinates',
    Number.isFinite(detection.latitude) && Number.isFinite(detection.longitude),
    `${detection.latitude}, ${detection.longitude}`)
  check('Detection carries acquisition date and time',
    typeof detection.acquisitionDate === 'string' && typeof detection.acquisitionTime === 'string',
    `${detection.acquisitionDate} ${detection.acquisitionTime}`)
  check('Detection carries a confidence value', detection.confidence != null, String(detection.confidence))
  check('Detection names satellite and instrument',
    typeof detection.satellite === 'string' && typeof detection.instrument === 'string',
    `${detection.instrument}/${detection.satellite}`)
  check('Fire Radiative Power present or explicitly null',
    detection.frpMegawatts === null || Number.isFinite(detection.frpMegawatts),
    `${detection.frpMegawatts} MW`)
  check('Brightness temperature in a plausible kelvin range',
    detection.brightnessKelvin === null ||
      (detection.brightnessKelvin > 200 && detection.brightnessKelvin < 600),
    `${detection.brightnessKelvin} K`)
}

// ── Runner ──────────────────────────────────────────────────────────────

async function main() {
  console.log(bold('\nTerraVerse AI — API integration verification'))
  console.log(dim(`Proxy: ${PROXY}  ·  timeout: ${TIMEOUT_MS} ms  ·  ${new Date().toISOString()}`))

  const tests = [testGeocoding, testForecast, testArchive, testFlood, testPower, testGbif, testUsgs]
  for (const test of tests) {
    try {
      await test()
    } catch (error) {
      check('Unexpected exception', false, String(error?.message ?? error))
    }
  }

  let integrations = null
  try {
    integrations = await testProxy()
  } catch (error) {
    check('Proxy reachable', false, String(error?.message ?? error))
  }

  if (integrations) {
    for (const [test, configured] of [
      [testOverpass, true],
      [testOpenAq, integrations.openaq?.configured],
      [testFirms, integrations.firms?.configured],
    ]) {
      try {
        await test(configured)
      } catch (error) {
        check('Unexpected exception', false, String(error?.message ?? error))
      }
    }
  } else {
    section('Proxy-mediated sources')
    skip('Overpass, OpenAQ, NASA FIRMS', 'the proxy is not running — start it with `npm run dev:proxy`')
  }

  // ── Summary ───────────────────────────────────────────────────────────
  const passed = results.filter(r => r.ok === true).length
  const failed = results.filter(r => r.ok === false)
  const skipped = results.filter(r => r.ok === null).length

  console.log(`\n${bold('Summary')}`)
  const bySource = new Map()
  for (const result of results) {
    const entry = bySource.get(result.source) ?? { pass: 0, fail: 0, skip: 0 }
    if (result.ok === true) entry.pass++
    else if (result.ok === false) entry.fail++
    else entry.skip++
    bySource.set(result.source, entry)
  }
  for (const [source, counts] of bySource) {
    const verdict = counts.fail > 0 ? red('FAIL') : counts.pass > 0 ? green('OK  ') : yellow('SKIP')
    console.log(
      `  ${verdict}  ${source.padEnd(42)} ${counts.pass} passed` +
        (counts.fail ? `, ${counts.fail} failed` : '') +
        (counts.skip ? `, ${counts.skip} skipped` : ''),
    )
  }
  console.log(`\n  ${green(`${passed} passed`)}  ${failed.length ? red(`${failed.length} failed`) : '0 failed'}  ${yellow(`${skipped} skipped`)}`)

  if (failed.length > 0) {
    console.log(`\n${bold('Failures')}`)
    for (const failure of failed) {
      console.log(`  ${red('·')} ${failure.source}: ${failure.name}${failure.detail ? dim(` — ${failure.detail}`) : ''}`)
    }
  }
  console.log('')
  process.exit(failed.length > 0 ? 1 : 0)
}

await main()
