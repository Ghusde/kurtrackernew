export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Fraunces', 'ui-serif'],
        body: ['Inter', 'system-ui'],
        mono: ['JetBrains Mono', 'monospace']
      }
    }
  },
  plugins: []
};
