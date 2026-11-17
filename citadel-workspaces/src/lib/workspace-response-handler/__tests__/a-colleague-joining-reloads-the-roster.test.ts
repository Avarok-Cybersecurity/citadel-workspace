/**
 * A colleague who joins reaches the rosters already on screen.
 *
 * The server announces the workspace record to its members when someone joins
 * (the kernel's connect enrolment). The sidebar reads its roster with a separate
 * ListMembers, once per domain, so the announcement has to turn into a reload --
 * and only when the membership moved, because the same record is announced for
 * every theme, profile and trust edit.
 *
 * Real handler and event bus; no doubles.
 */
import { describe, it, expect } from 'vitest';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { handleGeneratedVariants } from '../generated-variant-handlers';
import { eventEmitter } from '@/lib/event-emitter';

const connection: { request_id: string } = { request_id: 'broadcast' };

function record(id: string, members: string[], name: string = 'Acme'): WorkspaceProtocolResponse {
  return {
    Workspace: { id, name, description: '', owner_id: '', members, offices: [], metadata: [] },
  } as WorkspaceProtocolResponse;
}

function reloadsFor(responses: WorkspaceProtocolResponse[]): number {
  let reloads: number = 0;
  const off: () => void = eventEmitter.on('members:reload', (): void => { reloads += 1; });
  for (const response of responses) handleGeneratedVariants(response, connection as never);
  off();
  return reloads;
}

describe('a workspace announcement', () => {
  it('reloads the roster when a colleague has joined', () => {
    expect(reloadsFor([record('ws-join', ['alice']), record('ws-join', ['alice', 'bob'])])).toBe(1);
  });

  it('reloads it when someone has left', () => {
    expect(reloadsFor([record('ws-leave', ['alice', 'bob']), record('ws-leave', ['alice'])])).toBe(1);
  });

  it('does not reload for the record the page loaded with', () => {
    expect(reloadsFor([record('ws-first', ['alice', 'bob'])])).toBe(0);
  });

  it('does not reload for an edit that leaves the members alone', () => {
    // A profile, theme or trust change announces the same record. A reload per
    // settings click would be a request storm with nothing to show for it.
    const before: WorkspaceProtocolResponse = record('ws-edit', ['alice', 'bob']);
    const renamed: WorkspaceProtocolResponse = record('ws-edit', ['bob', 'alice'], 'Acme Ltd');
    expect(reloadsFor([before, renamed])).toBe(0);
  });

  it('tells workspaces apart', () => {
    expect(reloadsFor([record('ws-a', ['alice']), record('ws-b', ['bob'])])).toBe(0);
  });
});
