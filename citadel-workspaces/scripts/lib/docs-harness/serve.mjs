/**
 * Builds the docs harness page (index.html here) as the app builds itself: the app's React
 * plugin, `@` alias, Tailwind/PostCSS pipeline and, from vite.config.ts, its esbuild and worker
 * settings (how the cdoc worker is emitted) and its public dir (the vendored wasm). Then serves
 * the build with `vite preview`: a built bundle has no first-request compile for a measurement
 * to race.
 */
import { build, loadConfigFromFile, preview } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubWasmClient } from '../stub-wasm-client.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..', '..', '..');

export function serveDocsHarness(port) {
  return serveHarness(HERE, port);
}

/** The same build and preview for another harness page: `root` holds its index.html. */
export async function serveHarness(root, port) {
  const app = await loadConfigFromFile({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false }, resolve(APP_ROOT, 'vite.config.ts'));
  if (app === null || app.config.esbuild === undefined || app.config.worker === undefined) throw new Error('vite.config.ts gave no esbuild or worker settings');
  const outDir = mkdtempSync(join(tmpdir(), 'harness-'));
  const shared = {
    root,
    mode: 'production',
    esbuild: app.config.esbuild,
    worker: app.config.worker,
    // The app's build constants (__BUILD_SEQ__, vite.config.ts), which shipped modules read when they load.
    define: app.config.define,
    assetsInclude: app.config.assetsInclude,
    configFile: false,
    logLevel: 'error',
    publicDir: resolve(APP_ROOT, 'public'),
    // An app tab's pane reaches the Calendar's lazy chunk (first-party/registry.ts), and the
    // Calendar reaches the session's services: the build must resolve the glue it never loads.
    plugins: [react(), stubWasmClient()],
    css: { postcss: APP_ROOT },
    resolve: { alias: { '@': resolve(APP_ROOT, 'src') } },
  };
  await build({ ...shared, build: { outDir, emptyOutDir: true, chunkSizeWarningLimit: 100_000 } });
  const server = await preview({ ...shared, build: { outDir }, preview: { port, strictPort: true, host: '127.0.0.1' } });
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      await server.close();
      rmSync(outDir, { recursive: true, force: true });
    },
  };
}
