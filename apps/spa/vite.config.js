import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';

const httpsKey = process.env.MISU_HTTPS_KEY;
const httpsCert = process.env.MISU_HTTPS_CERT;

if (Boolean(httpsKey) !== Boolean(httpsCert)) {
  throw new Error('MISU_HTTPS_KEY and MISU_HTTPS_CERT must be provided together');
}

const https = httpsKey && httpsCert
  ? { key: readFileSync(httpsKey), cert: readFileSync(httpsCert) }
  : undefined;

export default defineConfig({
  plugins: [preact()],
  base: '/app/',
  server: {
    host: '0.0.0.0',
    https,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/static': 'http://127.0.0.1:8080'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js'
  }
});