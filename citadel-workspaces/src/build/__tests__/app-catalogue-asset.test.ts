/**
 * The global catalogue reaches the page at its same-origin URL: emitted into the bundle as it was
 * read, served by the dev server only for that URL, and a catalogue that cannot be read fails the
 * build instead of shipping a marketplace with nothing behind it.
 */
import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { appCataloguePlugin } from '../app-catalogue-asset';
import { GLOBAL_CATALOGUE_URL } from '@/lib/citadel-apps/listing-model';

const TEXT: string = '{"format":1,"catalogue_version":1,"entries":[]}';
type Hook = (this: unknown, ...args: unknown[]) => unknown;
const hook = (plugin: Plugin, name: 'generateBundle' | 'configureServer'): Hook => plugin[name] as unknown as Hook;

function emitted(read: () => string): { files: unknown[]; errors: string[] } {
  const files: unknown[] = [];
  const errors: string[] = [];
  const context: unknown = { emitFile: (f: unknown): void => { files.push(f); }, error: (m: string): never => { errors.push(m); throw new Error(m); } };
  try { hook(appCataloguePlugin(read), 'generateBundle').call(context); } catch { /* recorded in errors */ }
  return { files, errors };
}

function served(method: string, url: string): { body: string | null; passedOn: boolean } {
  let handler: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) | null = null;
  hook(appCataloguePlugin(() => TEXT), 'configureServer').call(null, { middlewares: { use: (h: typeof handler): void => { handler = h; } } });
  let body: string | null = null;
  let passedOn: boolean = false;
  const res: unknown = { setHeader: (): void => {}, end: (b: string): void => { body = b; } };
  (handler as unknown as (req: IncomingMessage, res: ServerResponse, next: () => void) => void)({ method, url } as IncomingMessage, res as ServerResponse, (): void => { passedOn = true; });
  return { body, passedOn };
}

describe('the catalogue asset', () => {
  it('is emitted at its URL as read', () => {
    expect(emitted(() => TEXT).files).toEqual([{ type: 'asset', fileName: GLOBAL_CATALOGUE_URL.slice(1), source: TEXT }]);
  });

  it('fails the build when the file cannot be read or is not JSON', () => {
    expect(emitted(() => { throw new Error('ENOENT'); }).errors[0]).toContain('ENOENT');
    expect(emitted(() => '{').errors).toHaveLength(1);
  });

  it('is served by the dev server at its URL only', () => {
    expect(served('GET', `${GLOBAL_CATALOGUE_URL}?x=1`)).toEqual({ body: TEXT, passedOn: false });
    expect(served('GET', '/apps/other.json')).toEqual({ body: null, passedOn: true });
    expect(served('POST', GLOBAL_CATALOGUE_URL)).toEqual({ body: null, passedOn: true });
  });
});
