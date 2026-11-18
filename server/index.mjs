/**
 * TerraVerse AI — backend API proxy.
 *
 * Exists for exactly three reasons:
 *
 *  1. OpenAQ v3 and NASA FIRMS require credentials. Those credentials must not
 *     reach the browser bundle, so the browser talks to this process instead
 *     and this process attaches the key.
 *  2. The Overpass API (OpenStreetMap) asks callers to identify themselves with
 *     a descriptive User-Agent, which a browser cannot set.
 *  3. It gives the frontend a single place to ask "which credentialed
 *     integrations are actually configured?" so the UI can say so honestly
 *     instead of showing a broken panel.
 *
 * Everything else (Open-Meteo, NASA POWER, GBIF, USGS) is keyless and
 * CORS-enabled, so the frontend calls those directly — no proxy hop needed.
 *
 * Deliberately dependency-free: Node's built-in http + fetch only.
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ── .env loading (no dotenv dependency) ────────────────────────────────────

function loadEnvFile(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return {}
  }
  const out = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (value !== '') out[key] = value
  }
  return out
}

const fileEnv = loadEnvFile(resolve(ROOT, '.env'))
const env = { ...fileEnv, ...process.env }

const PORT = Number(env.PROXY_PORT || 8787)
const OPENAQ_API_KEY = env.OPENAQ_API_KEY || ''
const NASA_FIRMS_MAP_KEY = env.NASA_FIRMS_MAP_KEY || ''
const OVERPASS_ENDPOINT = env.OVERPASS_ENDPOINT || 'https://overpass-api.de/api/interpreter'
const OSM_USER_AGENT =
  env.OSM_USER_AGENT || 'TerraVerseAI/1.0 (sustainable-computing coursework project)'

// ── Tiny shared helpers ───────────────────────────────────────────────────

const UPSTREAM_TIMEOUT_MS = 45_000
/**
 * Overpass is a shared volunteer service that queues requests when busy, so it
 * gets a longer ceiling than the rest — comfortably above the `[timeout:]` the
 * query itself declares, so Overpass gets the chance to answer (or to return
 * its own error) before our socket gives up.
 */
const OVERPASS_TIMEOUT_MS = 70_000

function send(res, status, body, extraHeaders = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  res.end(payload)
}

/** Shape every failure the same way so the frontend can render one error UI. */
function sendProxyError(res, status, code, message, detail) {
  send(res, status, { error: { code, message, detail: detail ?? null } })
}

async function fetchUpstream(url, init = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Only forward query params we understand — never blind-forward a URL. */
function pickParams(searchParams, allowed) {
  const out = new URLSearchParams()
  for (const key of allowed) {
    const value = searchParams.get(key)
    if (value !== null && value !== '') out.set(key, value)
  }
  return out
}

function numberParam(searchParams, key) {
  const raw = searchParams.get(key)
  if (raw === null || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

// ── Route: /api/health ────────────────────────────────────────────────────
// Tells the frontend which credentialed integrations are usable, so each
// module can show "needs a key" rather than a generic failure.

function handleHealth(res) {
  send(res, 200, {
    proxy: 'up',
    checkedAt: new Date().toISOString(),
    integrations: {
      openaq: { configured: Boolean(OPENAQ_API_KEY), keyName: 'OPENAQ_API_KEY' },
      firms: { configured: Boolean(NASA_FIRMS_MAP_KEY), keyName: 'NASA_FIRMS_MAP_KEY' },
      overpass: { configured: true, endpoint: OVERPASS_ENDPOINT },
    },
  })
}

// ── Route: /api/openaq/* ──────────────────────────────────────────────────

const OPENAQ_BASE = 'https://api.openaq.org/v3'

const OPENAQ_ROUTES = {
  locations: {
    path: () => '/locations',
    allowed: ['coordinates', 'radius', 'limit', 'page', 'parameters_id', 'bbox', 'order_by', 'sort_order'],
  },
  latest: {
    // /parameters/{id} style paths are handled via the `id` segment below.
    path: (id) => `/locations/${id}/latest`,
    allowed: ['limit', 'page'],
    needsId: true,
  },
  sensors: {
    path: (id) => `/locations/${id}/sensors`,
    allowed: ['limit', 'page'],
    needsId: true,
  },
}

async function handleOpenAq(req, res, url) {
  if (!OPENAQ_API_KEY) {
    return sendProxyError(
      res,
      503,
      'MISSING_API_KEY',
      'OpenAQ is not configured on this server. Set OPENAQ_API_KEY in .env and restart the proxy.',
      { keyName: 'OPENAQ_API_KEY', signup: 'https://explore.openaq.org/register' },
    )
  }

  // /api/openaq/<route>[/<id>]
  const segments = url.pathname.replace(/^\/api\/openaq\/?/, '').split('/').filter(Boolean)
  const routeName = segments[0]
  const route = OPENAQ_ROUTES[routeName]
  if (!route) {
    return sendProxyError(res, 404, 'UNKNOWN_ROUTE', `Unsupported OpenAQ route "${routeName ?? ''}".`)
  }

  let id = null
  if (route.needsId) {
    id = segments[1]
    if (!/^\d+$/.test(id ?? '')) {
      return sendProxyError(res, 400, 'BAD_REQUEST', 'This OpenAQ route requires a numeric location id.')
    }
  }

  const query = pickParams(url.searchParams, route.allowed)
  const upstream = `${OPENAQ_BASE}${route.path(id)}${query.size ? `?${query}` : ''}`

  try {
    const response = await fetchUpstream(upstream, {
      headers: { 'X-API-Key': OPENAQ_API_KEY, accept: 'application/json' },
    })
    const text = await response.text()

    if (response.status === 401 || response.status === 403) {
      return sendProxyError(res, 502, 'UPSTREAM_AUTH', 'OpenAQ rejected the configured API key.', {
        upstreamStatus: response.status,
      })
    }
    if (response.status === 429) {
      return sendProxyError(res, 429, 'RATE_LIMITED', 'OpenAQ rate limit reached. Try again shortly.', {
        retryAfter: response.headers.get('retry-after'),
      })
    }
    if (!response.ok) {
      return sendProxyError(res, 502, 'UPSTREAM_ERROR', `OpenAQ returned HTTP ${response.status}.`, {
        upstreamStatus: response.status,
        body: text.slice(0, 400),
      })
    }
    // Pass the payload straight through; normalisation belongs in the client.
    send(res, 200, text)
  } catch (err) {
    sendProxyError(res, 504, 'UPSTREAM_UNREACHABLE', 'Could not reach OpenAQ.', String(err?.message ?? err))
  }
}

// ── Route: /api/firms/area ────────────────────────────────────────────────
// NASA FIRMS serves CSV. We parse it here so the browser receives typed JSON
// and the key never leaves this process.

const FIRMS_SOURCES = new Set([
  'VIIRS_SNPP_NRT',
  'VIIRS_NOAA20_NRT',
  'VIIRS_NOAA21_NRT',
  'MODIS_NRT',
  'VIIRS_SNPP_SP',
  'MODIS_SP',
])

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const header = lines[0].split(',').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    const row = {}
    header.forEach((key, i) => {
      row[key] = (cells[i] ?? '').trim()
    })
    return row
  })
}

async function handleFirms(req, res, url) {
  if (!NASA_FIRMS_MAP_KEY) {
    return sendProxyError(
      res,
      503,
      'MISSING_API_KEY',
      'NASA FIRMS is not configured on this server. Set NASA_FIRMS_MAP_KEY in .env and restart the proxy.',
      { keyName: 'NASA_FIRMS_MAP_KEY', signup: 'https://firms.modaps.eosdis.nasa.gov/api/map_key' },
    )
  }

  const west = numberParam(url.searchParams, 'west')
  const south = numberParam(url.searchParams, 'south')
  const east = numberParam(url.searchParams, 'east')
  const north = numberParam(url.searchParams, 'north')
  if ([west, south, east, north].some((v) => v === null)) {
    return sendProxyError(res, 400, 'BAD_REQUEST', 'west, south, east and north are all required.')
  }
  if (west >= east || south >= north) {
    return sendProxyError(res, 400, 'BAD_REQUEST', 'Bounding box must satisfy west<east and south<north.')
  }

  const source = url.searchParams.get('source') || 'VIIRS_SNPP_NRT'
  if (!FIRMS_SOURCES.has(source)) {
    return sendProxyError(res, 400, 'BAD_REQUEST', `Unsupported FIRMS source "${source}".`)
  }

  // FIRMS caps the area endpoint at 10 days.
  const days = Math.min(Math.max(numberParam(url.searchParams, 'days') ?? 3, 1), 10)

  const area = [west, south, east, north].map((v) => v.toFixed(4)).join(',')
  const upstream = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${NASA_FIRMS_MAP_KEY}/${source}/${area}/${days}`

  try {
    const response = await fetchUpstream(upstream, { headers: { 'user-agent': OSM_USER_AGENT } })
    const text = await response.text()

    // FIRMS signals most problems with HTTP 200 and a plain-text message.
    if (/invalid\s+map_key/i.test(text)) {
      return sendProxyError(res, 502, 'UPSTREAM_AUTH', 'NASA FIRMS rejected the configured map key.')
    }
    if (/transaction limit/i.test(text) || response.status === 429) {
      return sendProxyError(res, 429, 'RATE_LIMITED', 'NASA FIRMS transaction limit reached. Try again later.')
    }
    if (!response.ok) {
      return sendProxyError(res, 502, 'UPSTREAM_ERROR', `NASA FIRMS returned HTTP ${response.status}.`, {
        body: text.slice(0, 400),
      })
    }
    if (!/latitude/i.test(text.split(/\r?\n/)[0] ?? '')) {
      return sendProxyError(res, 502, 'INVALID_RESPONSE', 'NASA FIRMS returned an unexpected payload.', {
        body: text.slice(0, 400),
      })
    }

    const rows = parseCsv(text)
    const detections = rows
      .map((r) => ({
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        // VIIRS reports bright_ti4; MODIS reports brightness.
        brightnessKelvin: Number(r.bright_ti4 ?? r.brightness ?? NaN),
        // Fire Radiative Power, megawatts.
        frpMegawatts: r.frp === '' || r.frp === undefined ? null : Number(r.frp),
        acquisitionDate: r.acq_date ?? null,
        acquisitionTime: r.acq_time ?? null,
        satellite: r.satellite ?? null,
        instrument: r.instrument ?? null,
        // VIIRS: 'l' | 'n' | 'h'. MODIS: 0-100.
        confidence: r.confidence ?? null,
        dayNight: r.daynight ?? null,
        version: r.version ?? null,
      }))
      .filter((d) => Number.isFinite(d.latitude) && Number.isFinite(d.longitude))

    send(res, 200, {
      source,
      days,
      bbox: { west, south, east, north },
      detectionCount: detections.length,
      detections,
      retrievedAt: new Date().toISOString(),
    })
  } catch (err) {
    sendProxyError(res, 504, 'UPSTREAM_UNREACHABLE', 'Could not reach NASA FIRMS.', String(err?.message ?? err))
  }
}

// ── Route: /api/overpass ──────────────────────────────────────────────────
// Accepts a bounding box plus a named, server-side-defined query template.
// The browser never supplies raw Overpass QL — that would let any visitor run
// arbitrary expensive queries through our identified User-Agent.

function overpassQuery(kind, bbox, limits) {
  const b = `${bbox.south.toFixed(5)},${bbox.west.toFixed(5)},${bbox.north.toFixed(5)},${bbox.east.toFixed(5)}`
  // Must stay below OVERPASS_TIMEOUT_MS so Overpass can report its own
  // timeout rather than us cutting the connection first.
  const timeout = 50
  switch (kind) {
    case 'urban':
      return `[out:json][timeout:${timeout}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${b});
);
out geom ${limits.roads};
(
  way["building"](${b});
);
out center ${limits.buildings};
(
  way["leisure"~"^(park|garden|nature_reserve)$"](${b});
  way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green)$"](${b});
);
out geom ${limits.green};`
    case 'water':
      return `[out:json][timeout:${timeout}];
(
  way["waterway"~"^(river|canal|stream)$"](${b});
  way["natural"="water"](${b});
  way["landuse"="reservoir"](${b});
);
out geom ${limits.water};`
    default:
      return null
  }
}

async function handleOverpass(req, res, url) {
  const kind = url.searchParams.get('kind') || 'urban'
  const west = numberParam(url.searchParams, 'west')
  const south = numberParam(url.searchParams, 'south')
  const east = numberParam(url.searchParams, 'east')
  const north = numberParam(url.searchParams, 'north')
  if ([west, south, east, north].some((v) => v === null)) {
    return sendProxyError(res, 400, 'BAD_REQUEST', 'west, south, east and north are all required.')
  }
  // Guard against someone asking for a continent and hammering Overpass.
  const span = Math.max(east - west, north - south)
  if (span <= 0 || span > 0.6) {
    return sendProxyError(res, 400, 'BAD_REQUEST', 'Bounding box must be positive and smaller than 0.6°.')
  }

  const limits = { roads: 300, buildings: 900, green: 150, water: 250 }
  const query = overpassQuery(kind, { west, south, east, north }, limits)
  if (!query) {
    return sendProxyError(res, 400, 'BAD_REQUEST', `Unsupported Overpass query kind "${kind}".`)
  }

  try {
    const response = await fetchUpstream(
      OVERPASS_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': OSM_USER_AGENT,
          accept: 'application/json',
        },
        body: new URLSearchParams({ data: query }).toString(),
      },
      OVERPASS_TIMEOUT_MS,
    )
    const text = await response.text()

    // Overpass signals "all query workers busy" with 429, 504, or a 502 whose
    // body says so. All three mean "come back shortly", not "broken".
    const atCapacity =
      response.status === 429 ||
      response.status === 504 ||
      (response.status === 502 && /at capacity|queue is full|gateway timeout/i.test(text))
    if (atCapacity) {
      return sendProxyError(
        res,
        429,
        'RATE_LIMITED',
        'The Overpass API is at capacity or rate-limiting this client. Retrying in a moment usually works.',
        { upstreamStatus: response.status },
      )
    }
    if (!response.ok) {
      return sendProxyError(res, 502, 'UPSTREAM_ERROR', `Overpass returned HTTP ${response.status}.`, {
        upstreamStatus: response.status,
        body: text.slice(0, 400),
      })
    }

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return sendProxyError(res, 502, 'INVALID_RESPONSE', 'Overpass returned a non-JSON payload.', {
        body: text.slice(0, 400),
      })
    }

    send(res, 200, {
      kind,
      bbox: { west, south, east, north },
      elementCount: Array.isArray(parsed.elements) ? parsed.elements.length : 0,
      truncated: {
        // Overpass honours our `out <n>` caps, so a full bucket means "at least this many".
        roads: limits.roads,
        buildings: limits.buildings,
        green: limits.green,
        water: limits.water,
      },
      osm: parsed,
      retrievedAt: new Date().toISOString(),
      attribution: '© OpenStreetMap contributors (ODbL), via Overpass API',
    })
  } catch (err) {
    // An abort here is our own timeout firing, which for Overpass almost always
    // means the request sat in its queue. Report it as a rate limit so the UI
    // offers a retry instead of claiming the service is down.
    const timedOut = err?.name === 'AbortError' || err?.name === 'TimeoutError'
    if (timedOut) {
      return sendProxyError(
        res,
        429,
        'RATE_LIMITED',
        `The Overpass API did not answer within ${Math.round(OVERPASS_TIMEOUT_MS / 1000)}s, which usually means the request is queued behind others. Retrying in a moment usually works.`,
      )
    }
    sendProxyError(res, 504, 'UPSTREAM_UNREACHABLE', 'Could not reach the Overpass API.', String(err?.message ?? err))
  }
}

// ── Server ────────────────────────────────────────────────────────────────

export async function handler(req, res) {
  let url
  try {
    url = new URL(req.url, `http://localhost:${PORT}`)
  } catch {
    return sendProxyError(res, 400, 'BAD_REQUEST', 'Malformed request URL.')
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    })
    return res.end()
  }

  if (req.method !== 'GET') {
    return sendProxyError(res, 405, 'METHOD_NOT_ALLOWED', 'This proxy only serves GET requests.')
  }

  try {
    if (url.pathname === '/api/health') return handleHealth(res)
    if (url.pathname.startsWith('/api/openaq')) return await handleOpenAq(req, res, url)
    if (url.pathname === '/api/firms/area') return await handleFirms(req, res, url)
    if (url.pathname === '/api/overpass') return await handleOverpass(req, res, url)
    return sendProxyError(res, 404, 'NOT_FOUND', `No proxy route for ${url.pathname}.`)
  } catch (err) {
    console.error('[proxy] unhandled error', err)
    return sendProxyError(res, 500, 'PROXY_ERROR', 'The proxy hit an unexpected error.')
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) createServer(handler).listen(PORT, () => {
  const state = (ok) => (ok ? 'configured' : 'MISSING KEY')
  console.log(`[proxy] TerraVerse API proxy listening on http://localhost:${PORT}`)
  console.log(`[proxy]   OpenAQ      : ${state(Boolean(OPENAQ_API_KEY))}`)
  console.log(`[proxy]   NASA FIRMS  : ${state(Boolean(NASA_FIRMS_MAP_KEY))}`)
  console.log(`[proxy]   Overpass    : ${OVERPASS_ENDPOINT}`)
  if (!OPENAQ_API_KEY || !NASA_FIRMS_MAP_KEY) {
    console.log('[proxy] Add missing keys to .env (see .env.example) and restart to enable those panels.')
  }
})
