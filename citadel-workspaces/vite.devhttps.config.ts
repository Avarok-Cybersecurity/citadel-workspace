// TEMPORARY diagnostic config (round 676): a dev-mode server over the same TLS
// cert the preview uses, so debugLog — a no-op in production — is observable.
import { defineConfig } from 'vite';
import fs from 'node:fs';
import base from './vite.config';

export default defineConfig(async (env) => {
  const cfg = typeof base === 'function' ? await base(env) : base;
  cfg.server = {
    ...(cfg.server ?? {}),
    port: 4202,
    strictPort: true,
    host: '127.0.0.1',
    https: {
      cert: fs.readFileSync('/tmp/work.test.crt'),
      key: fs.readFileSync('/tmp/work.test.key'),
    },
    hmr: false,
  };
  return cfg;
});
