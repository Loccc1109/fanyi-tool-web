import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// No /api proxy and no server runtime. dist/ is the complete deployment.
export default defineConfig({ plugins: [react()], base: './', worker: { format: 'es' } });
