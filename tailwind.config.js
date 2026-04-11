/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'lumos-bg': '#222222',
        'lumos-surface': '#2a2a2a',
        'lumos-yellow': '#EFC700',
        'lumos-text-primary': '#FFFFFF',
        'lumos-text-secondary': '#999999',
        'lumos-border': 'rgba(255,255,255,0.08)',
      },
      fontFamily: {
        heading: ['Poppins', 'sans-serif'],
        body: ['Work Sans', 'sans-serif'],
      },
      borderRadius: {
        lumos: '8px',
      }
    },
  },
  plugins: [],
}
