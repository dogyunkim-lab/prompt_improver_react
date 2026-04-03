/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ctp: {
          base: '#1e1e2e',
          surface0: '#313244',
          surface1: '#45475a',
          surface2: '#26263a',
          text: '#cdd6f4',
          mauve: '#cba6f7',
          blue: '#89b4fa',
          green: '#a6e3a1',
          yellow: '#f9e2af',
          red: '#f38ba8',
          overlay0: '#6c7086',
          subtext0: '#a6adc8',
          teal: '#89dceb',
        },
        warm: {
          bg: '#f5f5f0',
          card: '#ffffff',
          border: '#e0ddd4',
          text: '#333333',
          muted: '#888888',
          'table-bg': '#f8f7f3',
          'table-border': '#e8e4d9',
          hover: '#fafaf8',
        },
        score: {
          good: '#40a02b',
          warn: '#df8e1d',
          bad: '#d20f39',
        },
      },
    },
  },
  plugins: [],
};
