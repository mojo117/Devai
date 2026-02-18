/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        devai: {
          bg: '#0f1f17',
          surface: '#162b1f',
          card: '#1c3428',
          border: '#2a4d3a',
          'border-light': '#3d6b52',
          text: '#e8f0ec',
          'text-secondary': '#9ab5a6',
          'text-muted': '#6b8f7a',
          accent: '#f97316',
          'accent-hover': '#ea580c',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
