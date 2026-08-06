/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0e14',
        panel: '#0f1420',
        accent: '#39ff88',
        accent2: '#00e5ff',
        warn: '#ff5f56',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 12px rgba(57, 255, 136, 0.45)',
        glowCyan: '0 0 12px rgba(0, 229, 255, 0.45)',
      },
    },
  },
  plugins: [],
}
