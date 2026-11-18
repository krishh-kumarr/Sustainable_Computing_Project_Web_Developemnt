import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="bg-graphite text-ivory/40 py-10 px-6 mt-auto">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-ivory/10 flex items-center justify-center text-[10px] font-bold text-ivory">TV</div>
          <span className="text-sm font-medium text-ivory/60">TerraVerse AI</span>
        </div>
        <div className="text-xs text-center">
          Sustainable Computing Project · SRM IST · Data from Open-Meteo, NASA, OpenAQ, GBIF, USGS &amp; OpenStreetMap
        </div>
        <div className="flex gap-5 text-xs">
          <Link to="/" className="hover:text-ivory transition-colors">Overview</Link>
          <Link to="/explorer" className="hover:text-ivory transition-colors">Simulations</Link>
          <Link to="/data-sources" className="hover:text-ivory transition-colors">Data Sources</Link>
          <Link to="/about" className="hover:text-ivory transition-colors">About</Link>
        </div>
      </div>
    </footer>
  )
}
