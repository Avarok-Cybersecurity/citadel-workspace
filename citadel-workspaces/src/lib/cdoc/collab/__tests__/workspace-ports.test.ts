/**
 * The app's ports: client_seq bases no two sessions share and that leave the low 32 bits for
 * the count, roster names with a real hex colour, and no session without a signed-in user.
 */
import { describe, expect, it } from 'vitest';
import { randomClientSeqBase, rosterIdentity, workspaceCollabPorts } from '../workspace-ports';
import type { EditorController } from '../../editor/controller';

describe('workspace collaboration ports', () => {
  it('draws client_seq bases with room for 2^32 appends each', () => {
    const bases: bigint[] = Array.from({ length: 64 }, (): bigint => randomClientSeqBase());
    expect(bases.every((base: bigint): boolean => (base & 0xffff_ffffn) === 0n)).toBe(true);
    expect(new Set(bases).size).toBeGreaterThan(60);
  });

  it('names a session it knows nothing about by its handle, in a hex colour', () => {
    const who: ReturnType<typeof rosterIdentity> = rosterIdentity(42n);
    expect(who.name.length).toBeGreaterThan(0);
    expect(who.name).not.toBe('42');
    expect(who.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('refuses to build ports outside a signed-in session', () => {
    expect(() => workspaceCollabPorts((): Promise<EditorController> => Promise.reject(new Error('unused')), null)).toThrow('signed-in session');
  });
});
