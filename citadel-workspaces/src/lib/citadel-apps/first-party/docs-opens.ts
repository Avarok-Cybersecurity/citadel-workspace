/**
 * The files Citadel Docs opens, from its committed declaration (docs.opens.json). Docs is built
 * into the page, not a signed app, so the declaration has a manifest's `opens` shape and is checked
 * by the manifest's own rule in Rust (citadel-workspace-types/tests/apps_opens.rs): one schema,
 * one rule, for Docs and for every installed app.
 */
import type { FileOpens } from 'citadel-workspace-client-ts';
import declared from './docs.opens.json';
import { SURFACES } from '../manifest/manifest-shape';

function surfaceOf(name: string): FileOpens['surface'] {
  const surface: FileOpens['surface'] | undefined = SURFACES.find((s: FileOpens['surface']): boolean => s === name);
  if (surface === undefined) throw new Error(`docs.opens.json names no surface: ${name}`);
  return surface;
}

export const DOCS_OPENS: FileOpens = {
  extensions: declared.extensions,
  surface: surfaceOf(declared.surface),
  max_bytes: BigInt(declared.max_bytes),
};
