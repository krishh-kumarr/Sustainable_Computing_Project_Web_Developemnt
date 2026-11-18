import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, MapPin, Search, X } from 'lucide-react'
import { isAbort, type ApiError } from '../../services/api/client'
import { searchPlaces, type GeoPlace } from '../../services/api/openMeteo'
import { PRESET_LOCATIONS, useSelectedLocation } from '../../context/LocationContext'

/**
 * The global location control.
 *
 * Nothing here asks for or infers the device's position. The initial value is a
 * labelled starting point, and the UI says so, so the reader is never left
 * believing their location was detected.
 */
export default function LocationSelector() {
  const { location, label, setLocation, isDefault } = useSelectedLocation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoPlace[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounced geocoding search, with the previous request cancelled.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setSearching(true)
    setError(null)

    const timer = setTimeout(() => {
      searchPlaces(trimmed, { signal: controller.signal, count: 8 })
        .then((envelope) => {
          setResults(envelope.data)
          setSearching(false)
          if (envelope.data.length === 0) {
            setError(`No place matching "${trimmed}" in the Open-Meteo gazetteer.`)
          }
        })
        .catch((caught: unknown) => {
          if (isAbort(caught)) return
          setSearching(false)
          setResults([])
          setError(
            `Place search failed: ${(caught as ApiError)?.message ?? 'the geocoding service did not respond.'}`,
          )
        })
    }, 300)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const presets = useMemo(
    () => PRESET_LOCATIONS.filter((preset) => preset.id !== location.id),
    [location.id],
  )

  const choose = (place: GeoPlace) => {
    setLocation(place)
    setOpen(false)
    setQuery('')
    setResults([])
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-graphite/15 bg-white/70 hover:border-graphite/30 transition-colors max-w-[260px] group"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <MapPin size={13} className="text-sage shrink-0" />
        <span className="min-w-0 text-left">
          <span className="block text-[9px] uppercase tracking-widest text-graphite/35 font-medium leading-none mb-0.5">
            {isDefault ? 'Starting location' : 'Selected location'}
          </span>
          <span className="block text-[13px] font-medium text-graphite truncate leading-tight">{label}</span>
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[340px] max-w-[calc(100vw-2rem)] bg-white border border-graphite/12 rounded-xl shadow-lg overflow-hidden z-50">
          <div className="p-3 border-b border-graphite/8">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite/30" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search for a city…"
                className="w-full pl-8 pr-8 py-2 text-[13px] rounded-lg border border-graphite/12 bg-ivory/60 text-graphite placeholder:text-graphite/30 focus:outline-none focus:border-sage/50 transition-colors"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-graphite/30 hover:text-graphite/60"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
              {searching && (
                <Loader2
                  size={12}
                  className="absolute right-8 top-1/2 -translate-y-1/2 text-graphite/30 animate-spin"
                />
              )}
            </div>
            <p className="text-[10px] text-graphite/35 mt-2 leading-relaxed">
              Geocoded by the Open-Meteo gazetteer. The selected coordinates drive every module.
            </p>
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {error && <div className="px-4 py-3 text-[12px] text-graphite/50 leading-relaxed">{error}</div>}

            {results.length > 0 && (
              <ul role="listbox" className="py-1">
                {results.map((place) => (
                  <li key={`${place.id}-${place.latitude}`}>
                    <button
                      onClick={() => choose(place)}
                      className="w-full text-left px-4 py-2.5 hover:bg-ivory transition-colors flex items-start justify-between gap-3"
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-graphite truncate">{place.name}</span>
                        <span className="block text-[11px] text-graphite/45 truncate">
                          {[place.admin1, place.country].filter(Boolean).join(', ')}
                        </span>
                      </span>
                      <span className="text-[10px] text-graphite/30 font-mono shrink-0 mt-0.5 tabular-nums">
                        {place.latitude.toFixed(2)}, {place.longitude.toFixed(2)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {results.length === 0 && !error && (
              <div className="py-1">
                <div className="px-4 pt-2.5 pb-1.5 text-[10px] uppercase tracking-widest text-graphite/30 font-medium">
                  Suggested starting points
                </div>
                <ul role="listbox">
                  <li>
                    <div className="px-4 py-2.5 bg-sage/6 flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-graphite truncate">{location.name}</span>
                        <span className="block text-[11px] text-graphite/45 truncate">
                          {[location.admin1, location.country].filter(Boolean).join(', ')}
                        </span>
                      </span>
                      <Check size={13} className="text-sage shrink-0 mt-0.5" />
                    </div>
                  </li>
                  {presets.map((preset) => (
                    <li key={preset.id}>
                      <button
                        onClick={() => choose(preset)}
                        className="w-full text-left px-4 py-2.5 hover:bg-ivory transition-colors"
                      >
                        <span className="block text-[13px] font-medium text-graphite">
                          {preset.name}
                          <span className="text-graphite/40 font-normal">, {preset.country}</span>
                        </span>
                        <span className="block text-[11px] text-graphite/45 leading-snug mt-0.5">
                          {preset.coverageHint}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="px-4 py-2.5 border-t border-graphite/8 bg-graphite/[0.02]">
            <p className="text-[10px] text-graphite/40 leading-relaxed">
              This application does not request or detect your device location. Changing the selection refetches
              every module's data for the new coordinates.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
