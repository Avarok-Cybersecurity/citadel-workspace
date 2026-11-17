/**
 * A tree row draws the app's icon for a node only when its metadata decodes to an app; a plain
 * node, and one whose app record this client cannot read, keep their level's icon. No mocks.
 */
import { describe, it, expect } from 'vitest';
import { getEntityIcon } from '@/lib/entity-type-registry';
import { nodeIcon } from '../node-icon';
import { encodeNodeApp } from '../node-app-metadata';
import { citadelApp } from '../registry';

const LEVEL: { Child: string } = { Child: 'Floor' };
const bytesOf = (document: unknown): number[] => Array.from(new TextEncoder().encode(JSON.stringify(document)));

describe('the icon a tree row draws', () => {
  it('is the app icon for a document node', () => {
    expect(nodeIcon({ entity_type: LEVEL, metadata: Array.from(encodeNodeApp(null, 'docs')) })).toBe(citadelApp('docs').icon);
  });

  it('is the level icon for a node without an app', () => {
    expect(nodeIcon({ entity_type: LEVEL, metadata: [] })).toBe(getEntityIcon(LEVEL));
    expect(nodeIcon({ entity_type: LEVEL, metadata: [] })).not.toBe(citadelApp('docs').icon);
  });

  it('is the level icon when the app record cannot be read', () => {
    const newer: number[] = bytesOf({ citadel_app: { v: 9, kind: 'citadel-app', payload: { app: 'docs' } } });
    expect(nodeIcon({ entity_type: LEVEL, metadata: newer })).toBe(getEntityIcon(LEVEL));
  });
});
