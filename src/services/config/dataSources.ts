/**
 * Registry of every external data source the platform uses, plus the
 * vocabulary for describing what kind of number a given value actually is.
 *
 * Every metric rendered anywhere in the app must cite one of these sources and
 * one of these data kinds. That is the mechanism that keeps observations,
 * forecasts, model estimates and illustrative scenarios from blurring together.
 */

/** What kind of number is this? Drives the badge shown next to every metric. */
export type DataKind =
  /** Measured now (or within the provider's current-conditions window). */
  | 'observation'
  /** Measured in the past — a reanalysis or archived record. */
  | 'historical'
  /** A short-range numerical weather / hydrological forecast. */
  | 'forecast'
  /** A satellite detection — an instrument's inference, not a ground truth. */
  | 'satellite'
  /** Computed by a documented formula from stated inputs. */
  | 'model'
  /** A what-if the user is driving with sliders. Carries no predictive claim. */
  | 'illustrative'
  /** No source could supply this value. */
  | 'unavailable'

export const DATA_KIND_LABEL: Record<DataKind, string> = {
  observation: 'LIVE OBSERVATION',
  historical: 'HISTORICAL DATA',
  forecast: 'WEATHER FORECAST',
  satellite: 'SATELLITE DETECTION',
  model: 'MODEL ESTIMATE',
  illustrative: 'ILLUSTRATIVE SCENARIO',
  unavailable: 'DATA UNAVAILABLE',
}

/** One-line explanation of each label, surfaced in tooltips and legends. */
export const DATA_KIND_MEANING: Record<DataKind, string> = {
  observation:
    'A measured value returned by the provider for the current time window. Not a prediction.',
  historical:
    'A past measurement or reanalysis value from an archive. Updated periodically, not live.',
  forecast:
    'A short-range numerical weather or hydrological forecast. Not a long-term climate projection.',
  satellite:
    'A thermal anomaly or feature inferred by a satellite instrument. Not a confirmed ground observation.',
  model:
    'Calculated in-browser from the inputs shown, using the documented formula stated alongside it.',
  illustrative:
    'A user-driven what-if scenario for exploration. It is not fitted to data and makes no prediction.',
  unavailable:
    'No integrated source could supply this value for the selected location or period.',
}

/** Colour family per label — kept inside the existing editorial palette. */
export const DATA_KIND_TONE: Record<DataKind, { fg: string; bg: string; border: string }> = {
  observation: { fg: '#4A6356', bg: '#EDF3EE', border: '#64816C44' },
  historical: { fg: '#5B6E79', bg: '#EEF3F5', border: '#8CA8B544' },
  forecast: { fg: '#6B7F8C', bg: '#F0F6F9', border: '#8CA8B544' },
  satellite: { fg: '#9A6B25', bg: '#FBF4E8', border: '#C39A6244' },
  model: { fg: '#5C5445', bg: '#F4F1EA', border: '#C39A6238' },
  illustrative: { fg: '#6E6A60', bg: '#F1EFE9', border: '#25252218' },
  unavailable: { fg: '#8A8780', bg: '#F2F1ED', border: '#25252214' },
}

export type SourceId =
  | 'open-meteo-geocoding'
  | 'open-meteo-forecast'
  | 'open-meteo-archive'
  | 'open-meteo-flood'
  | 'nasa-power'
  | 'nasa-firms'
  | 'openaq'
  | 'gbif'
  | 'usgs-nwis'
  | 'openstreetmap'
  | 'browser-telemetry'
  | 'terraverse-model'
  | 'none'

export interface DataSource {
  id: SourceId
  /** Short name shown in the DATA SOURCE field. */
  name: string
  /** Who produced the underlying data. */
  provider: string
  /** Human-facing documentation or landing page. */
  docsUrl: string
  /** Required attribution string, where the provider specifies one. */
  attribution: string
  /** Does using this source need a credential? */
  requiresKey: boolean
  /** Name of the environment variable holding that credential. */
  keyEnvVar?: string
  /** Where a free key can be obtained. */
  keySignupUrl?: string
  /** Does the browser reach it through our proxy? */
  viaProxy: boolean
  /** What kinds of values this source can legitimately be cited for. */
  kinds: DataKind[]
  /** Known coverage limits that the UI must communicate. */
  coverageNote?: string
}

export const DATA_SOURCES: Record<SourceId, DataSource> = {
  'open-meteo-geocoding': {
    id: 'open-meteo-geocoding',
    name: 'Open-Meteo Geocoding',
    provider: 'Open-Meteo (GeoNames gazetteer)',
    docsUrl: 'https://open-meteo.com/en/docs/geocoding-api',
    attribution: 'Geocoding by Open-Meteo, data from GeoNames (CC BY 4.0)',
    requiresKey: false,
    viaProxy: false,
    kinds: ['observation'],
  },
  'open-meteo-forecast': {
    id: 'open-meteo-forecast',
    name: 'Open-Meteo Forecast',
    provider: 'Open-Meteo (national weather service models)',
    docsUrl: 'https://open-meteo.com/en/docs',
    attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
    requiresKey: false,
    viaProxy: false,
    kinds: ['observation', 'forecast'],
  },
  'open-meteo-archive': {
    id: 'open-meteo-archive',
    name: 'Open-Meteo Historical Weather',
    provider: 'Open-Meteo (ERA5 / ERA5-Land reanalysis)',
    docsUrl: 'https://open-meteo.com/en/docs/historical-weather-api',
    attribution: 'Historical weather by Open-Meteo.com, based on ERA5 reanalysis (CC BY 4.0)',
    requiresKey: false,
    viaProxy: false,
    kinds: ['historical'],
    coverageNote:
      'ERA5 reanalysis is a gridded model-assimilated record, not a station reading. The archive lags real time by roughly five days.',
  },
  'open-meteo-flood': {
    id: 'open-meteo-flood',
    name: 'Open-Meteo Flood API',
    provider: 'Copernicus Emergency Management Service — GloFAS',
    docsUrl: 'https://open-meteo.com/en/docs/flood-api',
    attribution: 'River discharge forecasts from GloFAS via Open-Meteo.com (CC BY 4.0)',
    requiresKey: false,
    viaProxy: false,
    kinds: ['forecast', 'historical'],
    coverageNote:
      'GloFAS resolves rivers on a coarse grid. Locations away from a modelled river cell return no discharge value at all.',
  },
  'nasa-power': {
    id: 'nasa-power',
    name: 'NASA POWER',
    provider: 'NASA Langley Research Center (MERRA-2 / SYN1deg)',
    docsUrl: 'https://power.larc.nasa.gov/docs/',
    attribution:
      'Data obtained from the NASA Langley Research Center POWER Project, funded through the NASA Earth Science Directorate Applied Science Program.',
    requiresKey: false,
    viaProxy: false,
    kinds: ['historical'],
    coverageNote:
      'POWER values are satellite-derived and model-assimilated on a ~0.5° grid, averaged over the grid cell rather than measured at the point. The daily record typically lags real time by several days.',
  },
  'nasa-firms': {
    id: 'nasa-firms',
    name: 'NASA FIRMS',
    provider: 'NASA Fire Information for Resource Management System',
    docsUrl: 'https://firms.modaps.eosdis.nasa.gov/',
    attribution:
      'Active fire data courtesy of NASA FIRMS (MODIS / VIIRS), NASA Earth Observing System Data and Information System.',
    requiresKey: false,
    viaProxy: true,
    kinds: ['satellite'],
    coverageNote:
      'Detections are thermal anomalies inferred from satellite radiance. They are not confirmed ground fires, and a cloudy or un-overflown area yields no detections regardless of what is burning.',
  },
  openaq: {
    id: 'openaq',
    name: 'OpenAQ v3',
    provider: 'OpenAQ (aggregated reference and low-cost monitors)',
    docsUrl: 'https://docs.openaq.org/',
    attribution: 'Air quality data aggregated by OpenAQ from government and research monitors.',
    requiresKey: false,
    viaProxy: true,
    kinds: ['observation'],
    coverageNote:
      'Coverage follows where monitors exist and report. Not every city has a monitor, and no monitor measures every pollutant.',
  },
  gbif: {
    id: 'gbif',
    name: 'GBIF',
    provider: 'Global Biodiversity Information Facility',
    docsUrl: 'https://techdocs.gbif.org/en/openapi/',
    attribution: 'Biodiversity occurrence records published through GBIF.org by their respective datasets.',
    requiresKey: false,
    viaProxy: false,
    kinds: ['observation'],
    coverageNote:
      'Occurrence records are observation and collection events, not a census. Record density reflects where people have surveyed and digitised, so absence of records is not evidence of absence of species.',
  },
  'usgs-nwis': {
    id: 'usgs-nwis',
    name: 'USGS Water Services',
    provider: 'U.S. Geological Survey National Water Information System',
    docsUrl: 'https://waterservices.usgs.gov/docs/',
    attribution: 'Streamflow and gauge height data from the U.S. Geological Survey NWIS.',
    requiresKey: false,
    viaProxy: false,
    kinds: ['observation', 'historical'],
    coverageNote:
      'USGS gauges cover the United States and its territories only. Readings are provisional and subject to revision.',
  },
  openstreetmap: {
    id: 'openstreetmap',
    name: 'OpenStreetMap (Overpass)',
    provider: 'OpenStreetMap contributors',
    docsUrl: 'https://wiki.openstreetmap.org/wiki/Overpass_API',
    attribution: '© OpenStreetMap contributors, Open Database Licence (ODbL)',
    requiresKey: false,
    viaProxy: true,
    kinds: ['observation'],
    coverageNote:
      'OSM is volunteer-mapped. Completeness varies by place; building and green-space coverage is uneven between cities and even between neighbourhoods.',
  },
  'browser-telemetry': {
    id: 'browser-telemetry',
    name: 'Browser runtime telemetry',
    provider: 'This browser tab (Performance / Navigator APIs)',
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Performance',
    attribution: 'Measured locally in the browser. Not transmitted anywhere.',
    requiresKey: false,
    viaProxy: false,
    kinds: ['observation'],
    coverageNote:
      'These values describe this browser tab only. They are not whole-machine CPU, memory or power measurements, and the browser deliberately coarsens them.',
  },
  'terraverse-model': {
    id: 'terraverse-model',
    name: 'TerraVerse in-browser model',
    provider: 'Calculated locally from the inputs shown',
    docsUrl: 'https://www.thegreengrid.org/en/resources/library-and-tools',
    attribution: 'Arithmetic performed in-browser; assumptions stated alongside each result.',
    requiresKey: false,
    viaProxy: false,
    kinds: ['model', 'illustrative'],
  },
  none: {
    id: 'none',
    name: 'No source',
    provider: '—',
    docsUrl: '',
    attribution: '',
    requiresKey: false,
    viaProxy: false,
    kinds: ['unavailable'],
  },
}

export function getSource(id: SourceId): DataSource {
  return DATA_SOURCES[id] ?? DATA_SOURCES.none
}

/** Sources each module depends on — powers the per-module status indicator. */
export const MODULE_SOURCES: Record<string, SourceId[]> = {
  climate: ['open-meteo-forecast', 'open-meteo-archive', 'nasa-power'],
  city: ['openaq', 'openstreetmap', 'open-meteo-forecast'],
  waste: ['none'],
  datacenter: ['browser-telemetry', 'terraverse-model'],
  forest: ['nasa-firms', 'gbif', 'open-meteo-forecast'],
  water: ['open-meteo-flood', 'usgs-nwis', 'open-meteo-forecast', 'open-meteo-archive'],
  agriculture: ['open-meteo-forecast', 'nasa-power'],
}
