/** Save sends one Update per changed role, in turn, and stops at the first refusal, keeping its words. */
import { describe, expect, it } from 'vitest';
import type { RoleChange, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { savePending, type PendingUpdate, type SaveOutcome } from '../save-roles';
import { SEED } from '@/test-utils/role-table';

const PENDING: PendingUpdate[] = [
  { id: 'member', name: 'Member', changes: [{ Rename: 'Crew' }] },
  { id: 'guest', name: 'Guest', changes: [{ Grant: ['SendMessages'] }] },
];

describe('savePending', () => {
  it('sends each role its own changes, one after another', async () => {
    const sent: Array<[string, RoleChange[]]> = [];
    const outcome: SaveOutcome = await savePending(PENDING, async (id: string, changes: RoleChange[]): Promise<WorkspaceRoles> => {
      sent.push([id, changes]);
      return SEED;
    });
    expect(sent).toEqual([['member', [{ Rename: 'Crew' }]], ['guest', [{ Grant: ['SendMessages'] }]]]);
    expect(outcome).toEqual({ saved: ['member', 'guest'], refused: null });
  });

  it('stops at a refusal, reports it verbatim, and does not send the rest', async () => {
    const sent: string[] = [];
    const outcome: SaveOutcome = await savePending(PENDING, async (id: string): Promise<WorkspaceRoles> => {
      sent.push(id);
      throw new Error('Permission denied: ManageRoles required');
    });
    expect(sent).toEqual(['member']);
    expect(outcome).toEqual({ saved: [], refused: { id: 'member', name: 'Member', reason: 'Permission denied: ManageRoles required' } });
  });
});
