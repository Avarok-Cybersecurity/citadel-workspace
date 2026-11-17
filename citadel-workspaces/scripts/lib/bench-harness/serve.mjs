#!/usr/bin/env node
/**
 * Builds the bench harness page (index.html here) with the app's own React plugin, `@` alias and
 * Tailwind/PostCSS pipeline, then serves the build with `vite preview`, cross-origin isolated
 * (COOP same-origin, COEP require-corp) so the page may call
 * performance.measureUserAgentSpecificMemory(). Runs until killed.
 *
 *   node scripts/lib/bench-harness/serve.mjs --port 4791 --out /tmp/bench-harness
 *
 * Both flags are required. The build is a production build, with the app's own esbuild and
 * worker settings read from vite.config.ts (what the shipped bundle strips and how its cdoc
 * worker is emitted), so the editor measured is built as the app builds it.
 */
import { build, loadConfigFromFile, preview } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..', '..', '..');
const ISOLATED = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

const { values } = parseArgs({ options: { port: { type: 'string' }, out: { type: 'string' } }, strict: true });
if (values.port === undefined || values.out === undefined) throw new Error('usage: serve.mjs --port N --out DIR');
const port = Number.parseInt(values.port, 10);
if (!Number.isInteger(port) || port <= 0) throw new Error(`--port ${values.port} is not a port`);
const outDir = resolve(values.out);

const app = await loadConfigFromFile({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false }, resolve(APP_ROOT, 'vite.config.ts'));
if (app === null || app.config.esbuild === undefined || app.config.worker === undefined) throw new Error('vite.config.ts gave no esbuild or worker settings');

const shared = {
  root: HERE,
  mode: 'production',
  esbuild: app.config.esbuild,
  worker: app.config.worker,
  // The app's build constants (__BUILD_SEQ__, vite.config.ts), which shipped modules read when they load.
  define: app.config.define,
  assetsInclude: app.config.assetsInclude,
  configFile: false,
  logLevel: 'warn',
  publicDir: resolve(APP_ROOT, 'public'),
  plugins: [react()],
  css: { postcss: APP_ROOT },
  resolve: { alias: { '@': resolve(APP_ROOT, 'src') } },
};
await build({ ...shared, build: { outDir, emptyOutDir: true, chunkSizeWarningLimit: 100_000 } });
await preview({ ...shared, build: { outDir }, preview: { port, strictPort: true, host: '127.0.0.1', headers: ISOLATED } });
console.log(`bench harness on http://127.0.0.1:${port}/`);
