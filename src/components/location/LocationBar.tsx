import { Globe2, MapPin } from 'lucide-react'
import LocationSelector from './LocationSelector'
import { useSelectedLocation } from '../../context/LocationContext'

/**
 * Location context shown at the top of every simulation, so the reader always
 * knows which coordinates the numbers below belong to.
 */
export default function LocationBar({ accentColor }: { accentColor?: string }) {
  const { location, label, isDefault } = useSelectedLocation()

  return (
    <div className="bg-white border border-graphite/10 rounded-xl px-5 py-4 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <span
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${accentColor ?? '#64816C'}18` }}
        >
          <MapPin size={15} style={{ color: accentColor ?? '#64816C' }} />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-graphite/35 font-medium mb-0.5">
            Every figure below describes
          </div>
          <div className="text-sm font-semibold text-graphite truncate">{label}</div>
          <div className="text-[11px] text-graphite/45 font-mono tabular-nums mt-0.5">
            {location.latitude.toFixed(4)}°, {location.longitude.toFixed(4)}°
            {location.elevationMetres !== null && ` · ${location.elevationMetres} m elevation`}
            {` · ${location.timezone}`}
          </div>
          {isDefault && (
            <div className="text-[11px] text-graphite/40 mt-1 flex items-center gap-1">
              <Globe2 size={10} />
              Default starting point — your location has not been detected.
            </div>
          )}
        </div>
      </div>
      <LocationSelector />
    </div>
  )
}
