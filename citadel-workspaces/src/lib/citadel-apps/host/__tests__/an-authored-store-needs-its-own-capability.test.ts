/**
 * `storage.node.authored` is its own capability in the page as in the kernel: a Kv* op on an
 * author's namespace is admitted by `storage.node.authored` and never by `storage.node`, and
 * listing every author's keys on a node takes it too. The page's check only refuses early; the
 * kernel decides again.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '../capabilities';
import { findOp, type OpEntry } from '../ops';
import { parseArgs } from '../op-args';

const held = (...caps: Capability[]): ReadonlySet<Capability> => new Set<Capability>(caps);
const kvSet: OpEntry = findOp('storage', 2) as OpEntry;
const listAuthored: OpEntry = findOp('storage', 12) as OpEntry;
const authored = { node_authored: { node_id: 'room', author: null } } as const;

describe('an author’s store on a node', () => {
  it('is admitted by storage.node.authored, not by storage.node (control: a node backend is the reverse)', () => {
    expect(kvSet.name).toBe('KvSet');
    expect(kvSet.admits({ backend: authored }, held('storage.node'))).toBe(false);
    expect(kvSet.admits({ backend: authored }, held('storage.node.authored'))).toBe(true);
    expect(kvSet.admits({ backend: { node: { node_id: 'room' } } }, held('storage.node.authored'))).toBe(false);
    expect(kvSet.admits({ backend: { node: { node_id: 'room' } } }, held('storage.node'))).toBe(true);
  });

  it('lists every author’s keys only with storage.node.authored, and reaches the server', () => {
    expect(listAuthored.name).toBe('KvListAuthored');
    const args: { node_id: string; prefix: string; cursor: null; } = { node_id: 'room', prefix: 'cal/', cursor: null };
    expect(listAuthored.admits(args, held('storage.node'))).toBe(false);
    expect(listAuthored.admits(args, held('storage.node.authored'))).toBe(true);
    expect(listAuthored.server(args)).toBe(true);
  });

  it('decodes an author or none, and refuses an author that is not text', () => {
    expect(parseArgs('KvGet', { backend: { node_authored: { node_id: 'room', author: 'ana' } }, key: 'k' })).not.toBeNull();
    expect(parseArgs('KvGet', { backend: authored, key: 'k' })).not.toBeNull();
    expect(parseArgs('KvGet', { backend: { node_authored: { node_id: 'room', author: 7 } }, key: 'k' })).toBeNull();
  });
});
