/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ivory:   '#F5F4EF',
        graphite:'#252A27',
        sage:    '#64816C',
        dusty:   '#8CA8B5',
        amber:   '#C39A62',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
