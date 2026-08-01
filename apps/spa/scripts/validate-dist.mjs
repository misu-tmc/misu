import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const required = ['index.html', 'manifest.webmanifest', 'sw.js', 'icons/misu.svg'];

await Promise.all(required.map((path) => access(new URL(path, dist))));

const html = await readFile(new URL('index.html', dist), 'utf8');
if (!html.includes('/app/assets/')) throw new Error('index.html does not reference Vite assets under /app');
if (!html.includes('/manifest.webmanifest')) throw new Error('index.html does not link the PWA manifest');

const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', dist), 'utf8'));
if (manifest.start_url !== '/app/booking') throw new Error('manifest start_url must be /app/booking');
if (manifest.display !== 'standalone') throw new Error('manifest must use standalone display mode');
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) throw new Error('manifest requires an icon');

const worker = await readFile(new URL('sw.js', dist), 'utf8');
if (!worker.includes("'/app/booking'")) throw new Error('service worker does not cache the SPA shell');
if (!worker.includes("url.pathname.startsWith('/api/')")) throw new Error('service worker must keep API requests network-only');

console.log(`validated PWA output in ${join(dist.pathname)}`);
