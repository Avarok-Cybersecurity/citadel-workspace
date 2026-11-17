import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GLOBAL_CATALOGUE_URL } from '../lib/citadel-apps/listing-model';

/**
 * The global app catalogue (the parent's apps/catalogue/catalogue.json, checked by
 * scripts/check-app-catalogue.mjs) served at `GLOBAL_CATALOGUE_URL`, same-origin with the UI: in
 * the production bundle as a static file, and from the dev server as the file now on disk. The
 * reading is given, so the plugin does no I/O of its own; a catalogue that cannot be read fails
 * the build rather than shipping a marketplace with nothing behind it.
 */
const PLUGIN_NAME: string = 'citadel-app-catalogue';

export function appCataloguePlugin(readCatalogue: () => string): Plugin {
  const read = (): string => {
    const text: string = readCatalogue();
    JSON.parse(text);
    return text;
  };
  return {
    name: PLUGIN_NAME,
    generateBundle(): void {
      try {
        this.emitFile({ type: 'asset', fileName: GLOBAL_CATALOGUE_URL.slice(1), source: read() });
      } catch (error: unknown) {
        this.error(`the app catalogue could not be read: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    configureServer(server: ViteDevServer): void {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void): void => {
        if (req.method !== 'GET' || req.url?.split('?')[0] !== GLOBAL_CATALOGUE_URL) { next(); return; }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(read());
      });
    },
  };
}
