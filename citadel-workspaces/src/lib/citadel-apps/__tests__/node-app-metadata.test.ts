/**
 * What a node opens in, stored in node metadata (node-page-abi.md §2): the frozen contract's own
 * fixtures (docs/contracts/batch-1116/fixtures/node-page-envelope) decode as the contract says,
 * v1's three document apps exactly as they always did, v2 to an installed app's page, and every
 * `invalid-*` to `unreadable` with a reason; a node without one is "no app" (never a default); the
 * writers MERGE into whatever else the metadata holds.
 *
 * No mocks: pure encode/decode over bytes. Negative controls (each applied, seen red, reverted):
 * dropping the unknown-field check fails `invalid-unknown-field`, `invalid-v1-with-install` and
 * `invalid-v2-unknown-payload-field`; dropping the v1-id refusal fails "never writes a page it would
 * refuse to read" (the fixture `invalid-v2-first-party-id` stays refused: "pdf" is not an app id either);
 * assigning over the document instead of spreading it fails both merge cases.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { decodeNodeApp, encodeNodeApp, encodeNodeAppPage, NODE_APP_METADATA_KEY, type NodeAppBinding } from '../node-app-metadata';

/** vitest runs from citadel-workspaces/; the contracts are beside it. */
const FIXTURES: string = resolve(process.cwd(), '../docs/contracts/batch-1116/fixtures/node-page-envelope');
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const names: string[] = readdirSync(FIXTURES).filter((n: string) => n.endsWith('.json')).sort();

const bytesOf = (document: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(document));
const documentOf = (bytes: Uint8Array): Record<string, unknown> => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
const asNode = (envelope: unknown): Uint8Array => bytesOf({ [NODE_APP_METADATA_KEY]: envelope });
const PAGE: { app: string; installId: string } = { app: 'work.synchronized.app', installId: 'inst_8f3a2c9d1e4b7a60' };

describe('the contract fixtures, as a node carries them', () => {
  const expected: Readonly<Record<string, NodeAppBinding>> = {
    'valid-v1-docs.json': { kind: 'document', app: 'docs' },
    'valid-v1-pdf.json': { kind: 'document', app: 'pdf' },
    'valid-v1-latex.json': { kind: 'document', app: 'latex' },
    'valid-v2-installed.json': { kind: 'installed', ...PAGE },
  };

  it('has the fixtures this table names, and invalid ones besides', () => {
    expect(names.filter((n: string) => n.startsWith('valid')).sort()).toEqual(Object.keys(expected).sort());
    expect(names.filter((n: string) => n.startsWith('invalid-')).length).toBeGreaterThanOrEqual(9);
  });

  it.each(names.filter((n: string) => n.startsWith('valid')))('%s decodes to what it names', (name: string) => {
    expect(decodeNodeApp(asNode(fixture(name)))).toEqual(expected[name]);
  });

  it.each(names.filter((n: string) => n.startsWith('invalid-')))('%s is unreadable, with a reason to show', (name: string) => {
    const read: NodeAppBinding = decodeNodeApp(asNode(fixture(name)));
    expect(read.kind).toBe('unreadable');
    if (read.kind === 'unreadable') expect(read.reason).toMatch(/^This node.{10,}\.$/);
  });

  it('v1 is written byte for byte as it always was', () => {
    for (const app of ['docs', 'pdf', 'latex'] as const) {
      expect(new TextDecoder().decode(encodeNodeApp(null, app))).toBe(`{"${NODE_APP_METADATA_KEY}":{"v":1,"kind":"citadel-app","payload":{"app":"${app}"}}}`);
      expect(documentOf(encodeNodeApp(null, app))[NODE_APP_METADATA_KEY]).toEqual(fixture(`valid-v1-${app}.json`));
    }
  });

  it('v2 is written as the contract fixture, and reads back as the page it names', () => {
    const encoded: Uint8Array = encodeNodeAppPage(null, PAGE);
    expect(documentOf(encoded)[NODE_APP_METADATA_KEY]).toEqual(fixture('valid-v2-installed.json'));
    expect(decodeNodeApp(encoded)).toEqual({ kind: 'installed', ...PAGE });
    expect(decodeNodeApp(encoded)).toEqual({ kind: 'installed', ...PAGE });
  });

  it('never writes a page it would refuse to read', () => {
    expect(() => encodeNodeAppPage(null, { app: 'pdf', installId: 'i' })).toThrow(/document app/);
    expect(() => encodeNodeAppPage(null, { app: 'Work.App', installId: 'i' })).toThrow(/not an app id/);
    expect(() => encodeNodeAppPage(null, { app: 'work.app', installId: '' })).toThrow(/no install/);
  });
});

describe('a node’s other metadata', () => {
  const existing: Uint8Array = bytesOf({ initialized: true, pinned: true, theme: { v: 1, kind: 'theme', payload: { hue: 210 } } });

  it('survives writing a document app or an app page, and only the app key changes', () => {
    for (const encoded of [encodeNodeApp(existing, 'docs'), encodeNodeAppPage(existing, PAGE)]) {
      const merged: Record<string, unknown> = documentOf(encoded);
      expect([merged.initialized, merged.pinned, merged.theme]).toEqual([true, true, { v: 1, kind: 'theme', payload: { hue: 210 } }]);
      expect(Object.keys(merged).sort()).toEqual([NODE_APP_METADATA_KEY, 'initialized', 'pinned', 'theme'].sort());
    }
  });

  it('keeps its keys when a document node becomes a page', () => {
    const page: Uint8Array = encodeNodeAppPage(encodeNodeApp(existing, 'latex'), PAGE);
    expect(documentOf(page).initialized).toBe(true);
    expect(decodeNodeApp(page)).toEqual({ kind: 'installed', ...PAGE });
  });

  it('is "none", never a default app, when it names no app or is not a JSON object', () => {
    for (const metadata of [new Uint8Array(), null, bytesOf({ pinned: true }), new Uint8Array([0xff, 0x00, 0x13])]) expect(decodeNodeApp(metadata)).toEqual({ kind: 'none' });
  });

  it('is unreadable, not "none", when its app record is malformed', () => {
    expect(decodeNodeApp(asNode('docs'))).toMatchObject({ kind: 'unreadable' });
    expect(decodeNodeApp(asNode({ v: 1, kind: 'citadel-app' }))).toEqual({ kind: 'unreadable', reason: 'This node\'s app record has no “payload”.' });
  });
});
