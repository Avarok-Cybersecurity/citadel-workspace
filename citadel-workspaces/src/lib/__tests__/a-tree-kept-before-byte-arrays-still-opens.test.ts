/**
 * The workspace tree this browser kept for offline use holds each node's metadata as the page
 * received it. A page from before byte fields arrived as Uint8Array kept a list of numbers; this
 * one keeps a Uint8Array. Both must read back as the same node, and anything else is still
 * refused rather than shown.
 */
import { describe, expect, it } from 'vitest';
import { readCachedTree } from '@/lib/offline-tree';

const METADATA: string = '{"citadel_app":{"v":1,"kind":"citadel-app","payload":{"app":"docs"}}}';
const node = (metadata: unknown): Record<string, unknown> => ({ id: 'plan', name: 'Quarterly plan', metadata });
const kept = (metadata: unknown): unknown => ({ savedAt: 1_700_000_000_000, nodes: { plan: node(metadata) } });
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('a kept workspace tree', () => {
  it('reads a node kept as a list of numbers by an earlier page as bytes', () => {
    const tree = readCachedTree(kept(Array.from(new TextEncoder().encode(METADATA))));
    const metadata: Uint8Array | undefined = tree?.nodes.plan.metadata;
    expect(ArrayBuffer.isView(metadata)).toBe(true);
    expect(text(metadata as Uint8Array)).toBe(METADATA);
  });

  it('reads a node kept as bytes by this page unchanged', () => {
    const tree = readCachedTree(kept(new TextEncoder().encode(METADATA)));
    expect(text(tree?.nodes.plan.metadata as Uint8Array)).toBe(METADATA);
  });

  it('refuses metadata that is neither bytes nor a list of byte values', () => {
    for (const bad of ['{}', [1, 256], [0.5], { 0: 1 }, null]) {
      expect(() => readCachedTree(kept(bad))).toThrow(/not one/);
    }
  });
});
