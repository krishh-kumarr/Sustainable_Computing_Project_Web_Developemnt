import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import LocationSelector from '../location/LocationSelector'

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const links = [
    { label: 'Overview', href: '/' },
    { label: 'Simulations', href: '/explorer' },
    { label: 'Data Sources', href: '/data-sources' },
    { label: 'Green Software', href: '/green-software' },
    { label: 'About', href: '/about' },
  ]

  // Only the landing page puts a dark hero directly under the transparent bar.
  // Everywhere else the page starts on ivory, so graphite text is correct.
  const overDarkHero = location.pathname === '/' && !scrolled
  const onSimulationPage = location.pathname.startsWith('/simulation/')

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-white/90 backdrop-blur-md border-b border-graphite/8 shadow-sm' : 'bg-transparent'
      }`}
    >
      <nav className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Wordmark */}
        <Link to="/" className="flex items-center gap-2.5 group">
          <div
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors duration-300 ${
              overDarkHero ? 'bg-ivory' : 'bg-graphite'
            }`}
          >
            <span className={`text-xs font-bold ${overDarkHero ? 'text-graphite' : 'text-ivory'}`}>TV</span>
          </div>
          <span
            className={`font-semibold text-[15px] tracking-tight transition-colors duration-300 ${
              overDarkHero ? 'text-ivory' : 'text-graphite'
            }`}
          >
            TerraVerse AI
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-7">
          {links.map(l => (
            <Link
              key={l.href}
              to={l.href}
              className={`text-sm font-medium transition-colors duration-200 ${
                overDarkHero
                  ? location.pathname === l.href
                    ? 'text-ivory'
                    : 'text-ivory/60 hover:text-ivory'
                  : location.pathname === l.href
                    ? 'text-graphite'
                    : 'text-graphite/50 hover:text-graphite'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Global location selector + CTA. Simulation pages carry their own
            selector in the location bar, so the header one is hidden there to
            avoid showing the same control twice. */}
        <div className="hidden lg:flex items-center gap-3">
          {!onSimulationPage && <LocationSelector />}
          <Link
            to="/explorer"
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors duration-200 shrink-0 ${
              overDarkHero
                ? 'bg-ivory text-graphite hover:bg-white'
                : 'bg-graphite text-ivory hover:bg-graphite/90'
            }`}
          >
            Explore
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className={`lg:hidden transition-colors duration-200 ${overDarkHero ? 'text-ivory' : 'text-graphite'}`}
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="lg:hidden bg-white border-b border-graphite/10 px-6 py-4 flex flex-col gap-4"
          >
            {!onSimulationPage && (
              <div className="pb-1">
                <LocationSelector />
              </div>
            )}
            {links.map(l => (
              <Link
                key={l.href}
                to={l.href}
                onClick={() => setMobileOpen(false)}
                className="text-sm font-medium text-graphite/70 hover:text-graphite"
              >
                {l.label}
              </Link>
            ))}
            <Link
              to="/explorer"
              onClick={() => setMobileOpen(false)}
              className="px-4 py-2 text-sm font-medium bg-graphite text-ivory rounded-lg text-center"
            >
              Explore Platform
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
