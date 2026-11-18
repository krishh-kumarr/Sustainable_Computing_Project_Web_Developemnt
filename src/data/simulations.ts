import type { SourceId } from '../services/config/dataSources'

/**
 * Module metadata.
 *
 * Note what is absent: the hard-coded "metrics" this file used to carry. Those
 * were invented figures, and a card cannot honestly show a value for a location
 * the reader has not yet chosen. Cards now describe which sources a module
 * draws on; the numbers appear in the module, attributed and timestamped.
 */
export interface SimulationMeta {
  id: string
  title: string
  subtitle: string
  description: string
  color: string
  accentColor: string
  bgColor: string
  icon: string
  /**
   * 'live'      — runs on keyless APIs, works out of the box.
   * 'model'     — a transparent calculator, no external data source.
   * 'pending'   — the integration it needs is not built yet.
   */
  status: 'live' | 'model' | 'pending'
  tags: string[]
  /** Sources this module queries, in order of prominence. */
  sources: SourceId[]
  /** What the module actually puts on screen, in plain terms. */
  shows: string[]
  /** What it deliberately does not claim. */
  doesNotClaim: string
}

export const STATUS_LABEL: Record<SimulationMeta['status'], string> = {
  live: 'Live data',
  model: 'Calculator',
  pending: 'Integration pending',
}

export const simulations: SimulationMeta[] = [
  {
    id: 'climate',
    title: 'Climate Intelligence',
    subtitle: 'Observed conditions & reanalysis',
    description:
      'Current conditions, a short-range weather forecast and five years of ERA5 reanalysis for any location, alongside NASA POWER solar and meteorological records.',
    color: '#3B82F6',
    accentColor: '#93C5FD',
    bgColor: '#EFF6FF',
    icon: '🌡️',
    status: 'live',
    tags: ['Climate', 'Observations', 'Reanalysis'],
    sources: ['open-meteo-forecast', 'open-meteo-archive', 'nasa-power'],
    shows: [
      'Current temperature, humidity, wind, cloud cover and pressure',
      'Seven-day weather forecast with daily maxima, minima and precipitation',
      'Monthly temperature and precipitation from five years of ERA5 reanalysis',
      'NASA POWER surface solar irradiance over a recent 90-day window',
    ],
    doesNotClaim:
      'A seven-day weather forecast is not a climate projection, and no deep-learning climate model is implemented here.',
  },
  {
    id: 'waste',
    title: 'Smart Waste',
    subtitle: 'Classification interface',
    description:
      'An upload and classification interface built against a documented model contract, plus the published composition of the public waste datasets a classifier would be trained on.',
    color: '#10B981',
    accentColor: '#6EE7B7',
    bgColor: '#ECFDF5',
    icon: '♻️',
    status: 'pending',
    tags: ['Recycling', 'Computer vision', 'Datasets'],
    sources: ['none'],
    shows: [
      'Image upload with client-side validation and preview',
      'The response contract a classification service must satisfy',
      'TrashNet and TACO dataset composition as published by their authors',
    ],
    doesNotClaim:
      'There is no trained classifier in this application, so no prediction and no accuracy figure is shown.',
  },
  {
    id: 'city',
    title: 'Smart City',
    subtitle: 'Urban fabric & air quality',
    description:
      'Real road, building and green-space geometry from OpenStreetMap, with air-quality readings from the nearest OpenAQ monitoring station and a US EPA index computed from them.',
    color: '#8B5CF6',
    accentColor: '#C4B5FD',
    bgColor: '#F5F3FF',
    icon: '🏙️',
    status: 'live',
    tags: ['Urban', 'Air quality', 'OpenStreetMap'],
    sources: ['openstreetmap', 'open-meteo-forecast'],
    shows: [
      'Mapped road network, building footprints and green spaces in 3D',
      'Road and building density, and mapped green cover, per km²',
      'Weather and mapped urban-fabric context for the selected location',
    ],
    doesNotClaim:
      'No traffic data provider is integrated, so nothing here describes current or predicted traffic.',
  },
  {
    id: 'datacenter',
    title: 'Green Data Centre',
    subtitle: 'Transparent PUE calculator',
    description:
      'An auditable energy and emissions model you drive with explicit inputs, next to the only figures a web page can honestly measure: this browser tab\'s own runtime telemetry.',
    color: '#64816C',
    accentColor: '#A7C4AE',
    bgColor: '#F0F7F1',
    icon: '🖥️',
    status: 'model',
    tags: ['Computing', 'PUE', 'Emissions'],
    sources: ['terraverse-model', 'browser-telemetry'],
    shows: [
      'PUE computed as total facility energy ÷ IT equipment energy',
      'Annual energy, emissions and cost derived from your inputs',
      'The full formula chain, so the arithmetic can be checked by hand',
      'This tab\'s measured frame timing, JS heap and long-task counts',
    ],
    doesNotClaim:
      'No API reports live power for an arbitrary data centre, and a browser cannot read whole-machine CPU or power. Nothing here is a facility measurement.',
  },
  {
    id: 'forest',
    title: 'Forest Intelligence',
    subtitle: 'Fire detections & biodiversity records',
    description:
      'GBIF biodiversity occurrence records plotted at their true coordinates, with the fire-weather conditions behind them.',
    color: '#D97706',
    accentColor: '#FCD34D',
    bgColor: '#FFFBEB',
    icon: '🌲',
    status: 'live',
    tags: ['Forests', 'Satellite', 'Biodiversity'],
    sources: ['gbif', 'open-meteo-forecast'],
    shows: [
      'GBIF occurrence records, species tallies and the datasets that published them',
      'Observed temperature, humidity, wind and recent rainfall as fire-weather inputs',
    ],
    doesNotClaim:
      'Satellite detections are not confirmed ground fires. No deforestation rate and no wildfire probability is published, because neither dataset is integrated.',
  },
  {
    id: 'water',
    title: 'AquaGuard',
    subtitle: 'Discharge forecasts & gauge observations',
    description:
      'GloFAS river-discharge forecasts and, inside US coverage, live USGS streamflow and gauge-height readings, driving a water scene that reacts to the actual numbers.',
    color: '#0EA5E9',
    accentColor: '#7DD3FC',
    bgColor: '#F0F9FF',
    icon: '💧',
    status: 'live',
    tags: ['Water', 'Hydrology', 'Flood'],
    sources: ['open-meteo-flood', 'usgs-nwis', 'open-meteo-forecast'],
    shows: [
      'GloFAS river discharge: reanalysis behind today, forecast ahead of it',
      'USGS discharge and gauge height where the gauge network reaches',
      'Observed and forecast precipitation driving the rainfall visualisation',
      'A scenario slider for water level, labelled as such',
    ],
    doesNotClaim:
      'GloFAS has no modelled river in many grid cells and USGS is US-only. Where there is no gauge reading, none is invented — including for Indian rivers.',
  },
  {
    id: 'agriculture',
    title: 'AgriFuture',
    subtitle: 'Soil, solar & irrigation balance',
    description:
      'Soil moisture, solar radiation and reference evapotranspiration for your location, turned into an FAO-56 irrigation water balance with every assumption on screen.',
    color: '#84CC16',
    accentColor: '#BEF264',
    bgColor: '#F7FEE7',
    icon: '🌾',
    status: 'live',
    tags: ['Agriculture', 'Soil', 'Irrigation'],
    sources: ['open-meteo-forecast', 'nasa-power'],
    shows: [
      'Volumetric soil moisture in the 0–7 cm layer',
      'Reference evapotranspiration (FAO-56 Penman-Monteith) from the provider',
      'NASA POWER surface solar irradiance',
      'Net and gross irrigation requirement from Kc × ET₀ − effective rainfall',
    ],
    doesNotClaim:
      'No validated crop growth model is implemented, so the module makes no yield prediction of any kind.',
  },
]
