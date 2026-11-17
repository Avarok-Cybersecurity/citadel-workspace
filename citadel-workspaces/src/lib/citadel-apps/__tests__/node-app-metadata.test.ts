/**
 * The app a document node opens in, stored in node metadata: it round-trips, it is MERGED into
 * whatever else the metadata holds, a node without one is "no app" (never a default app), and
 * an app record this client cannot read is a loud failure rather than a guess.
 *
 * No mocks: pure encode/decode over bytes.
 */
import { describe, it, expect } from 'vitest';
import {
  decodeNodeApp,
  encodeNodeApp,
  nodeAppState,
  NodeAppMetadataError,
  NODE_APP_METADATA_KEY,
} from '../node-app-metadata';

const bytesOf = (document: unknown): number[] => Array.from(new TextEncoder().encode(JSON.stringify(document)));
const documentOf = (bytes: Uint8Array): Record<string, unknown> => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;

describe('node app metadata', () => {
  it('round-trips every app id, as the bytes the wire carries and as a typed array', () => {
    for (const app of ['docs', 'pdf', 'latex'] as const) {
      const encoded: Uint8Array = encodeNodeApp(null, app);
      expect(decodeNodeApp(encoded)).toBe(app);
      expect(decodeNodeApp(Array.from(encoded))).toBe(app);
    }
  });

  it('keeps every other key the metadata already had', () => {
    const existing: number[] = bytesOf({ pinned: true, theme: { v: 1, kind: 'theme', payload: { hue: 210 } } });
    const merged: Record<string, unknown> = documentOf(encodeNodeApp(existing, 'docs'));
    expect(merged.pinned).toBe(true);
    expect(merged.theme).toEqual({ v: 1, kind: 'theme', payload: { hue: 210 } });
    expect(decodeNodeApp(Array.from(encodeNodeApp(existing, 'docs')))).toBe('docs');
  });

  it('replaces only its own key when the app changes', () => {
    const once: Uint8Array = encodeNodeApp(bytesOf({ pinned: true }), 'docs');
    const twice: Record<string, unknown> = documentOf(encodeNodeApp(once, 'latex'));
    expect(Object.keys(twice).sort()).toEqual([NODE_APP_METADATA_KEY, 'pinned'].sort());
    expect(decodeNodeApp(encodeNodeApp(once, 'latex'))).toBe('latex');
  });

  it('is null, not a default app, for a node that names none', () => {
    expect(decodeNodeApp([])).toBeNull();
    expect(decodeNodeApp(null)).toBeNull();
    expect(decodeNodeApp(bytesOf({ pinned: true }))).toBeNull();
    expect(decodeNodeApp([0xff, 0x00, 0x13])).toBeNull();
    expect(nodeAppState([])).toEqual({ kind: 'none' });
  });

  it('fails loudly on an envelope version it does not know', () => {
    const newer: number[] = bytesOf({ [NODE_APP_METADATA_KEY]: { v: 2, kind: 'citadel-app', payload: { app: 'docs' } } });
    expect(() => decodeNodeApp(newer)).toThrow(NodeAppMetadataError);
    expect(() => decodeNodeApp(newer)).toThrow(/version 2/);
    expect(nodeAppState(newer)).toMatchObject({ kind: 'unreadable' });
  });

  it('fails loudly on an app id it does not know, and on a malformed record', () => {
    const unknownApp: number[] = bytesOf({ [NODE_APP_METADATA_KEY]: { v: 1, kind: 'citadel-app', payload: { app: 'sheets' } } });
    expect(() => decodeNodeApp(unknownApp)).toThrow(/sheets/);
    expect(() => decodeNodeApp(bytesOf({ [NODE_APP_METADATA_KEY]: 'docs' }))).toThrow(NodeAppMetadataError);
    expect(() => decodeNodeApp(bytesOf({ [NODE_APP_METADATA_KEY]: { v: 1, kind: 'other', payload: { app: 'docs' } } }))).toThrow(/kind other/);
  });
});
