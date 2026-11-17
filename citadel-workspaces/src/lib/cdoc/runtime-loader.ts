/**
 * The one door from the app shell into Citadel Docs: a dynamic import. Everything behind it
 * (worker, glue, binary, painter) loads when a document opens; the lazy-load test fails if any
 * shell module imports cdoc any other way.
 */
import type { CdocRuntime } from './runtime';

export type CdocRuntimeFactory = () => Promise<CdocRuntime>;

export const loadCdocRuntime: CdocRuntimeFactory = async (): Promise<CdocRuntime> =>
  (await import('./runtime')).spawnCdocRuntime();
