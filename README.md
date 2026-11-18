# TerraVerse AI

An interactive environmental-data platform. Seven simulation modules query public
scientific APIs for a location you choose, and present what comes back with the
provenance intact: source, units, observation time, and an explicit distinction
between what was measured, what was forecast, what was calculated and what is
only a what-if.

The governing rule is that no number appears on screen without a source. Where
no source can supply a value, the platform says so and shows nothing — it never
substitutes a placeholder.

---

## Quick start

```bash
npm install
cp .env.example .env     # optional: adjust proxy settings, see below
npm run dev              # starts Vite and the API proxy together
```

Open <http://localhost:5173>.

All modules work without an account or API key. Credential-gated integrations
are not part of the application.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server + API proxy together (the normal way to run it) |
| `npm run dev:web` | Vite only |
| `npm run dev:proxy` | API proxy only, on port 8787 |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build (start `dev:proxy` alongside it) |
| `npm run lint` | oxlint |
| `npm run test:apis` | Hit every real endpoint and assert on the real payloads |

---

## Architecture

```
server/index.mjs              Backend proxy for public providers that need a descriptive User-Agent.
scripts/dev.mjs               Runs Vite and the proxy together.
scripts/test-apis.mjs         End-to-end verification against the live APIs.

src/services/
  api/client.ts               One HTTP path for everything: caching, de-duplication,
                              retry, cancellation, validation, typed error taxonomy.
  api/openMeteo.ts            Geocoding, current conditions, forecast, ERA5 archive, GloFAS.
  api/nasaPower.ts            Solar irradiance and meteorology.
  api/openAq.ts               Air-quality monitors (via proxy).
  api/nasaFirms.ts            Satellite fire detections (via proxy).
  api/gbif.ts                 Biodiversity occurrence records.
  api/usgs.ts                 US streamflow and gauge height.
  api/openStreetMap.ts        Urban fabric via Overpass (via proxy).
  api/proxyHealth.ts          Proxy availability and integration health.
  config/dataSources.ts       Source registry + the provenance-label vocabulary.
  domain/aqi.ts               US EPA Air Quality Index (40 CFR 58 App. G).
  domain/energyModel.ts       PUE and emissions arithmetic.
  domain/browserTelemetry.ts  What a browser tab can honestly measure about itself.
  domain/wasteClassification.ts  Model contract and client. No model is bundled.
  hooks/                      One hook per domain, all built on useAsyncData.
  data/normalizers/units.ts   Explicit unit conversions.

src/components/data/          DataSourceBadge, LastUpdated, MetricCard, DataStatus,
                              DataUnavailable, SourcePanel, DataSourceStatus, Panel.
src/context/LocationContext   The selected location, shared by every module.
src/modules/                  One component per simulation.
src/three/scenes/             3D scenes, each wired to real values.
src/simulation/               Deterministic engines, typed parameters,
                              shared scenario state, comparisons and advisor rules.
src/components/simulation/    Shared model workbench: controls, transport,
                              live charts, exports, comparisons and assumptions.
```

Every simulation route retains its domain-specific real-data panels and scene,
and also mounts the shared model workbench. The workbench is the complete
interaction loop: parameters advance the engine, the live series and metrics
update, and the same run can be paused, reset, exported or compared with a
captured baseline. Cross-module levers persist for the current browser session.

The **Green Software Monitor** is available at `/green-software`. It measures
tab-local frame timing, API requests, response transfer size, cache hits,
active scenes and cleanup events using browser APIs and the shared request
client. It does not claim to measure device power, energy or carbon because
web pages cannot access those values.

### How a value reaches the screen

1. A hook calls a service function with the selected coordinates and an `AbortSignal`.
2. `requestJson` checks the fresh cache, de-duplicates against any identical
   request in flight, then fetches with a timeout and bounded retry.
3. A `parse` function validates the payload and rejects anything off-contract.
   Missing values become `null`; they are never defaulted to zero.
4. The result is wrapped in an `Envelope` carrying the source id, the provenance
   kind, the provider's observation timestamp and the fetch time.
5. `DataStatus` renders loading, error or unavailable states around it.
6. `MetricCard` and `SourcePanel` render the value with its unit, its provenance
   badge and a link to the provider.

### Caching and refresh

Caching is keyed on every input that affects the output, so navigating between
modules does not refetch. TTLs follow how often each provider actually updates:
current conditions 10 min, air quality 10 min, USGS 10 min, fire detections
30 min, GloFAS 1 h, GBIF 1 h, NASA POWER 12 h, Overpass 6 h, geocoding 24 h.
Current conditions, air quality and USGS additionally refresh on a 15-minute
interval while their panel is open.

### Credentials

Secrets are read **only** by `server/index.mjs`. Nothing secret is ever prefixed
`VITE_`, because every `VITE_` variable is inlined into the client bundle and is
therefore public. The browser calls `/api/...`, Vite proxies that to the Node
process, and the Node process attaches the key.

Keyless, CORS-enabled providers (Open-Meteo, NASA POWER, GBIF, USGS) are called
directly from the browser — a proxy hop would add latency for no benefit.

---

## Integration status

### Working, no credential required

| Source | Used by | What is displayed |
| --- | --- | --- |
| [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) | Global location selector | City, country, admin region, coordinates, timezone, elevation |
| [Open-Meteo Forecast](https://open-meteo.com/en/docs) | Climate, City, Forest, Water, Agriculture | Current temperature, apparent temperature, humidity, precipitation, wind speed and direction, cloud cover, surface pressure; 7-day daily max/min, precipitation sum and probability; hourly soil moisture, ET₀ and radiation |
| [Open-Meteo Historical (ERA5)](https://open-meteo.com/en/docs/historical-weather-api) | Climate | Five years of daily temperature and precipitation, aggregated to monthly means |
| [Open-Meteo Flood (GloFAS)](https://open-meteo.com/en/docs/flood-api) | AquaGuard | River discharge — 30 days of reanalysis and 14 days of forecast, plus the long-term daily mean |
| [NASA POWER](https://power.larc.nasa.gov/docs/) | Climate, Agriculture | All-sky and clear-sky surface irradiance, 2 m temperature, corrected precipitation, relative humidity |
| [GBIF](https://techdocs.gbif.org/en/openapi/) | Forest | Occurrence records with coordinates, species, taxonomic class, event date and publishing dataset |
| [USGS NWIS](https://waterservices.usgs.gov/docs/) | AquaGuard | Discharge and gauge height from active gauges, with provisional flags |

### Working, credential-free but proxied

[OpenStreetMap via Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) —
proxied so the request carries the descriptive `User-Agent` the OSM usage policy
asks for, which a browser cannot set. Used by Smart City for road centrelines,
building footprints and green-space polygons. Overpass is a shared volunteer
service and is sometimes at capacity; the app reports that as a rate limit with a
retry rather than as a hard failure.

### Not integrated

| Feature | Module | Why |
| --- | --- | --- |
| Long-term climate projection | Climate | NEX-GDDP-CMIP6 is NetCDF on S3/THREDDS, not a point-query API, and a credible projection is a multi-model ensemble with a stated spread. Long-horizon sliders are labelled ILLUSTRATIVE SCENARIO. |
| Deforestation rate | Forest | Hansen Global Forest Change needs raster tile processing; the GFW API needs a key and predefined geometries. Also, tree-cover loss is not deforestation. No percentage is published. |
| Wildfire probability | Forest | Requires a calibrated fire-danger model validated against historical ignitions. The module shows fire-weather inputs instead. |
| Live traffic | Smart City | Probe data is commercial and licence-restricted. Road classification is shown; no traffic claim is made. |
| Indian river gauges | AquaGuard | India-WRIS and CWC publish portals and PDF bulletins, not documented CORS-enabled APIs with redistribution rights. `data.gov.in` holds historical CSVs with inconsistent station ids. No Indian gauge reading is fabricated. |
| Waste classification model | Smart Waste | No trained model is bundled. The upload interface, result interface and validated service layer exist; set `VITE_WASTE_MODEL_ENDPOINT` to enable. |
| Live data-centre power | Green Data Centre | No free public API reports power for an arbitrary facility, and a browser cannot read whole-machine CPU or power. The module is a transparent calculator beside this tab's own measured telemetry. |

The in-app **Data Sources** page renders all of the above live.

---

## Provenance labels

Every figure carries exactly one.

| Label | Meaning |
| --- | --- |
| `LIVE OBSERVATION` | Measured value for the current time window. Not a prediction. |
| `HISTORICAL DATA` | Past measurement or reanalysis from an archive. Periodically updated, not live. |
| `WEATHER FORECAST` | Short-range numerical forecast. Not a climate projection. |
| `SATELLITE DETECTION` | Inferred by a satellite instrument. Not a confirmed ground observation. |
| `MODEL ESTIMATE` | Calculated in-browser from the inputs shown, by the stated formula. |
| `ILLUSTRATIVE SCENARIO` | A user-driven what-if. Not fitted to data, predicts nothing. |
| `DATA UNAVAILABLE` | No integrated source could supply this value here. |

Timestamps follow the same discipline: when a provider supplies an observation
time, that is shown; when it does not, the fetch time is shown and labelled as
such. Fetch time is never presented as observation time.

---

## Calculated quantities, and their citations

| Quantity | Method | Where |
| --- | --- | --- |
| Air Quality Index | US EPA, 40 CFR Part 58 Appendix G (2024 PM2.5 revision). Overall AQI is the maximum sub-index, as the standard defines. The UI states the averaging-period mismatch for PM, O₃ and CO, and the 25 °C / 1 atm assumption behind any µg/m³ → ppb conversion. | `domain/aqi.ts` |
| PUE | Total facility energy ÷ IT equipment energy (The Green Grid / ISO-IEC 30134-2). The full formula chain and all six assumptions are rendered on screen. | `domain/energyModel.ts` |
| Irrigation requirement | FAO-56: net = Kc × ET₀ − effective rainfall; gross = net ÷ application efficiency. ET₀ is the provider's own Penman-Monteith value. Kc from FAO-56 Table 12. | `hooks/useAgriData.ts` |
| Road / building / green density | Mapped feature length or count ÷ query-box ground area. Described as density *of mapped features*, with a truncation warning when a result hits the cap. | `api/openStreetMap.ts` |
| Tab main-thread load | Shortfall between achieved frame rate and the display's apparent refresh rate. Explicitly not CPU utilisation. | `domain/browserTelemetry.ts` |

---

## Data-driven 3D

Each scene carries a legend naming what every visual element encodes and marking
the decorative ones as decorative.

- **Earth** — NASA Blue Marble textures served locally. Marker at the selected
  coordinates, tinted by observed temperature (−10 to 45 °C); cloud-layer opacity
  follows reported cloud cover; key light dims when the provider reports night.
- **Smart City** — actual OSM road centrelines coloured by classification, building
  footprints at their real positions (raised only where `building:levels` exists,
  flat otherwise), green-space polygons, and a hall tint from the measured EPA index.
- **Forest** — one ember per FIRMS detection at its reported coordinates, sized by
  Fire Radiative Power on a log scale; GBIF occurrence records as points; haze from
  observed humidity. The canopy is decorative and labelled so.
- **AquaGuard** — rain particles from the rainfall rate, surface height from the
  observed gauge height (or a clearly labelled scenario), flow speed from GloFAS
  discharge.
- **AgriFuture** — soil colour from volumetric moisture (0.05–0.40 m³/m³), light
  from irradiance, sway from wind speed, rain from rainfall rate. Crop height and
  spacing are fixed and labelled as not data.
- **Green Data Centre** — lit rack units from modelled utilisation, airflow from the
  cooling-overhead fraction, tint from renewable share, and one arc showing this
  tab's measured main-thread load.

---

## Testing

`npm run test:apis` exercises the live endpoints directly — it does not import the
app's service layer, so a pass means the provider actually returned usable data.
For each source it verifies the endpoint, the response shape, the transformation
(monthly aggregation, MJ→kWh, cfs→m³/s, species tally, road density, EPA
sub-index), the units, the timestamps, and a failure path.

Last run on this machine: **73 passed, 0 failed, 2 skipped.** The two skips are
the credentialed sources, which have no keys configured here; both correctly
reported `MISSING_API_KEY` naming the variable to set, and neither fell back to
substitute data.

Browser verification covered all seven modules: every keyless source returned and
rendered data, the credential-required states named their variables, and the
genuine unavailable cases (GloFAS with no river cell at Chennai, USGS outside the
US, Open-Meteo soil moisture over the US domain) each reported honestly instead of
substituting a value.

---

## Dependencies

No new runtime dependencies were added. The backend proxy uses only Node built-ins
(`node:http`, `node:fs`, global `fetch`), and the dev runner uses
`node:child_process` rather than `concurrently`.

Existing stack: React 19, React Router 7, Three.js with React Three Fiber and drei,
Recharts, Framer Motion, Tailwind CSS, TypeScript, Vite.

---

## Environment variables

See `.env.example`. `PROXY_PORT`, `OVERPASS_ENDPOINT` and `OSM_USER_AGENT` are optional
proxy settings. `VITE_WASTE_MODEL_ENDPOINT` is a public URL, safe to expose; leave
it unset and Smart Waste reports that model integration is pending.

Never commit a filled-in `.env` — it is gitignored.

---

## Attribution

- Weather, reanalysis, geocoding and flood data by [Open-Meteo.com](https://open-meteo.com) (CC BY 4.0); river discharge from Copernicus EMS GloFAS.
- Solar and meteorological data from the NASA Langley Research Center POWER Project.
- Active fire data courtesy of NASA FIRMS (MODIS / VIIRS), NASA EOSDIS.
- Air quality aggregated by OpenAQ from government and research monitors.
- Biodiversity occurrence records published through GBIF.org by their respective datasets.
- Streamflow and gauge height from the U.S. Geological Survey NWIS (provisional, subject to revision).
- Map data © OpenStreetMap contributors, ODbL, via the Overpass API.
- Earth textures are NASA Visible Earth / Blue Marble derivatives distributed with the three.js examples.
