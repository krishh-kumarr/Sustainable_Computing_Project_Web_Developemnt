import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import Layout from './components/layout/Layout'
import { LocationProvider } from './context/LocationContext'
import { Loader2 } from 'lucide-react'

const About = lazy(() => import('./pages/About'))
const DataSources = lazy(() => import('./pages/DataSources'))
const Explorer = lazy(() => import('./pages/Explorer'))
const Home = lazy(() => import('./pages/Home'))
const SimulationPage = lazy(() => import('./pages/SimulationPage'))
const GreenSoftwareMonitor = lazy(() => import('./pages/GreenSoftwareMonitor'))
import { SharedScenarioProvider } from './simulation/state/SharedScenarioContext'

export default function App() {
  return (
    // The selected location lives above the router so navigating between
    // modules neither resets it nor refetches data the cache already holds.
    <LocationProvider>
      <SharedScenarioProvider>
        <Suspense fallback={<div className="min-h-screen bg-ivory flex items-center justify-center text-graphite/45"><Loader2 size={18} className="animate-spin" /></div>}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="explorer" element={<Explorer />} />
              <Route path="simulation/:id" element={<SimulationPage />} />
              <Route path="data-sources" element={<DataSources />} />
              <Route path="green-software" element={<GreenSoftwareMonitor />} />
              <Route path="about" element={<About />} />
            </Route>
          </Routes>
        </Suspense>
      </SharedScenarioProvider>
    </LocationProvider>
  )
}
