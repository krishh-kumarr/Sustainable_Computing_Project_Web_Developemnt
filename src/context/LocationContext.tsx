/**
 * The selected location, shared by every module.
 *
 * Two deliberate behaviours:
 *
 *  - The default is a named, labelled starting point, not a guess at where the
 *    user is. Nothing in this app asks for or infers the device's location, and
 *    the UI never implies it has detected one.
 *  - Changing location changes the dependency identity every data hook keys on,
 *    so in-flight requests for the old place are aborted and every visualisation
 *    refetches for the new one.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { placeLabel, type GeoPlace } from '../services/api/openMeteo'

/**
 * Starting points chosen to span climate zones and data-coverage regimes, so
 * the platform's coverage gaps are discoverable rather than hidden. The USGS
 * and OpenAQ notes below are facts about provider coverage, not predictions.
 */
export const PRESET_LOCATIONS: (GeoPlace & { coverageHint: string })[] = [
  {
    id: 1264527,
    name: 'Chennai',
    country: 'India',
    countryCode: 'IN',
    admin1: 'Tamil Nadu',
    admin2: 'Chennai district',
    latitude: 13.08784,
    longitude: 80.27847,
    elevationMetres: 14,
    timezone: 'Asia/Kolkata',
    population: 4681087,
    coverageHint: 'Tropical coastal monsoon city. No USGS gauges — that network is US-only.',
  },
  {
    id: 1273294,
    name: 'Delhi',
    country: 'India',
    countryCode: 'IN',
    admin1: 'Delhi',
    admin2: null,
    latitude: 28.65195,
    longitude: 77.23149,
    elevationMetres: 216,
    timezone: 'Asia/Kolkata',
    population: 10927986,
    coverageHint: 'Dense air-quality monitor coverage; strong seasonal particulate signal.',
  },
  {
    id: 5128581,
    name: 'New York',
    country: 'United States',
    countryCode: 'US',
    admin1: 'New York',
    admin2: null,
    latitude: 40.71427,
    longitude: -74.00597,
    elevationMetres: 10,
    timezone: 'America/New_York',
    population: 8175133,
    coverageHint: 'Inside USGS gauge coverage, so streamflow observations are available.',
  },
  {
    id: 2988507,
    name: 'Paris',
    country: 'France',
    countryCode: 'FR',
    admin1: 'Île-de-France',
    admin2: 'Paris',
    latitude: 48.85341,
    longitude: 2.3488,
    elevationMetres: 42,
    timezone: 'Europe/Paris',
    population: 2138551,
    coverageHint: 'Very complete OpenStreetMap coverage; good for the urban-fabric view.',
  },
  {
    id: 3663517,
    name: 'Manaus',
    country: 'Brazil',
    countryCode: 'BR',
    admin1: 'Amazonas',
    admin2: null,
    latitude: -3.10194,
    longitude: -60.025,
    elevationMetres: 25,
    timezone: 'America/Manaus',
    population: 1598210,
    coverageHint: 'Amazon basin — the most informative place to read fire detections and GBIF records.',
  },
  {
    id: 2077963,
    name: 'Alice Springs',
    country: 'Australia',
    countryCode: 'AU',
    admin1: 'Northern Territory',
    admin2: null,
    latitude: -23.69748,
    longitude: 133.88362,
    elevationMetres: 545,
    timezone: 'Australia/Darwin',
    population: 25186,
    coverageHint: 'Arid interior. Sparse monitoring — a good test of how the app reports missing data.',
  },
]

export interface LocationContextValue {
  location: GeoPlace
  label: string
  setLocation: (place: GeoPlace) => void
  /** True until the user has chosen a location themselves. */
  isDefault: boolean
  /** Monotonic counter; increments on every location change. */
  revision: number
}

const LocationContext = createContext<LocationContextValue | null>(null)

const STORAGE_KEY = 'terraverse.location.v1'

function readStoredLocation(): GeoPlace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<GeoPlace>
    if (typeof parsed.latitude !== 'number' || typeof parsed.longitude !== 'number' || !parsed.name) {
      return null
    }
    return parsed as GeoPlace
  } catch {
    return null
  }
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const stored = readStoredLocation()
  const [location, setLocationState] = useState<GeoPlace>(stored ?? PRESET_LOCATIONS[0])
  const [isDefault, setIsDefault] = useState(stored === null)
  const [revision, setRevision] = useState(0)

  const setLocation = useCallback((place: GeoPlace) => {
    setLocationState(place)
    setIsDefault(false)
    setRevision((n) => n + 1)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(place))
    } catch {
      // A private-mode browser refusing storage is not worth surfacing.
    }
  }, [])

  const value = useMemo<LocationContextValue>(
    () => ({ location, label: placeLabel(location), setLocation, isDefault, revision }),
    [location, setLocation, isDefault, revision],
  )

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>
}

export function useSelectedLocation(): LocationContextValue {
  const context = useContext(LocationContext)
  if (!context) throw new Error('useSelectedLocation must be used inside a LocationProvider.')
  return context
}
