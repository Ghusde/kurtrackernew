import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API lives in ./api as Vercel serverless functions on the SAME origin,
// so no dev proxy is needed: `vercel dev` serves both. Running bare `vite`
// requires VITE_API_URL pointing at a deployed API instead.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  }
});
