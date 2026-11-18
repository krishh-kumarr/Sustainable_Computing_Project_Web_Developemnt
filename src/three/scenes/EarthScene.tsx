import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import EarthGlobe from './EarthGlobe'
import { useSelectedLocation } from '../../context/LocationContext'
import { useWeather } from '../../services/hooks/useClimateData'

/**
 * Landing-page hero globe.
 *
 * Connected to the same selected location and the same live observation the
 * Climate module uses, so the first thing a visitor sees is already real data
 * rather than decoration. While the request is in flight the marker simply
 * renders neutral — it never shows a placeholder temperature.
 */
export default function EarthScene() {
  const { location } = useSelectedLocation()
  const weather = useWeather(location, { forecastDays: 1 })
  const current = weather.envelope?.data.current ?? null

  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [0, 0, 3], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
        style={{ background: 'transparent' }}
      >
        <Suspense fallback={null}>
          <EarthGlobe
            marker={{
              latitude: location.latitude,
              longitude: location.longitude,
              label: location.name,
              temperatureCelsius: current?.temperature ?? null,
            }}
            cloudCoverPercent={current?.cloudCover ?? null}
            isDay={current?.isDay ?? null}
            interactive={false}
          />
        </Suspense>
      </Canvas>
    </div>
  )
}
