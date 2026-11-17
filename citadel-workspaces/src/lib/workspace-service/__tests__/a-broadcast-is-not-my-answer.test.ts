/**
 * The write gate matches responses by TYPE, because the workspace protocol
 * carries no request id. That was safe while those variants only ever went to
 * the client that asked — and stopped being safe when the server began
 * broadcasting `Node`, `NodeDeleted` and `NodeMoved` to every other member so
 * their trees would update live.
 *
 * The harm is not a mismatched toast. Alice saves a document that the server is
 * about to refuse; Bob renames any node in the same 15-second window; his
 * broadcast `Node` resolves Alice's pending write; the editor closes on
 * "success" and reloads the stored copy over her buffer. Her text is gone under
 * a green toast — the exact data loss the write gate was built to end.
 *
 * The `matches` parameter existed for precisely this and was passed only for
 * group messages.
 */

import { describe, it, expect, vi  } from 'vitest';
import { awaitWriteResponse } from '../await-write-response';
import { eventEmitter } from '@/lib/event-emitter';
import {
  aboutNode,
  newChildOf,
  nodeWithId,
  workspaceChangedTo,
  workspaceWithId,
} from '../response-matchers';

const MINE: "node-mine" = 'node-mine';
const THEIRS: "node-theirs" = 'node-theirs';

function emitLater(response: unknown): void {
  setTimeout(() => eventEmitter.emit('workspace:raw-response', response), 0);
}

describe('a write waiting for its answer', () => {
  it('is not resolved by another member\'s broadcast of the same variant', async () => {
    const send: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
    let settled: boolean = false;

    const pending: Promise<void> = awaitWriteResponse('UpdateNode', send, nodeWithId(MINE))
      .then(() => { settled = true; })
      .catch(() => { settled = true; });

    emitLater({ Node: { id: THEIRS, name: 'renamed by Bob' } });
    await new Promise((r) => setTimeout(r, 10));

    expect(settled, 'someone else\'s tree write resolved this one').toBe(false);

    // Let our own answer through so the pending promise does not outlive the test.
    eventEmitter.emit('workspace:raw-response', { Node: { id: MINE } });
    await pending;
  });

  it('is resolved by its own answer', async () => {
    const send: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
    const pending: Promise<void> = awaitWriteResponse('UpdateNode', send, nodeWithId(MINE));

    emitLater({ Node: { id: MINE, name: 'saved' } });

    await expect(pending).resolves.toBeUndefined();
  });

  it('still rejects on a refusal, which carries no node id at all', async () => {
    const send: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
    const pending: Promise<void> = awaitWriteResponse('UpdateNode', send, nodeWithId(MINE));

    // An Error has to settle the write whatever the matcher says, or a refusal
    // would time out at 15s instead of reporting the reason.
    emitLater({ Error: 'Permission denied: EditMdx required' });

    await expect(pending).rejects.toThrow(/EditMdx/);
  });

  it('tells a delete of one node from a delete of another', async () => {
    const send: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
    let settled: boolean = false;

    const pending: Promise<void> = awaitWriteResponse('DeleteNode', send, aboutNode(MINE))
      .then(() => { settled = true; })
      .catch(() => { settled = true; });

    emitLater({ NodeDeleted: { node_id: THEIRS, children_deleted: [] } });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);

    eventEmitter.emit('workspace:raw-response', { NodeDeleted: { node_id: MINE, children_deleted: [] } });
    await pending;
  });

  it('matches a creation on what the client actually knows', async () => {
    // The client has no id for a node it has not created yet, so it matches on
    // parent and name. Narrower than any `Node` at all, which is the point.
    const match: (payload: unknown) => boolean = newChildOf('office-1', 'Standup');

    expect(match({ id: 'x', parent_id: 'office-1', name: 'Standup' })).toBe(true);
    expect(match({ id: 'y', parent_id: 'office-2', name: 'Standup' })).toBe(false);
    expect(match({ id: 'z', parent_id: 'office-1', name: 'Retro' })).toBe(false);
  });

  it('treats a missing parent_id as the root, not as a mismatch', () => {
    expect(newChildOf(null, 'Workspace')({ name: 'Workspace' })).toBe(true);
  });
});

/**
 * The `Workspace` variant needed the same treatment, and for two reasons at
 * once rather than one.
 *
 * `GetWorkspace` answers `Workspace`, so a concurrent READ in the same tab
 * resolved a pending rename. And `UpdateWorkspace` / `UpdateWorkspaceTheme`
 * broadcast `Workspace` to the other members, so a colleague's theme save
 * resolved it too. Either way the settings form toasts "updated successfully",
 * clears its dirty flag and closes, while the server's actual `Error` — no
 * permission, or a wrong master password — arrives after the handler has
 * unsubscribed and surfaces, if at all, as a disjoint global toast. The name is
 * unchanged and the admin believes it is not.
 */
describe('a workspace write waiting for its answer', () => {
  it('is not resolved by a concurrent read of the workspace as it is now', async () => {
    const send: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
    let settled: boolean = false;

    // The rename in flight: "Acme" -> "Acme Corp".
    const pending: Promise<void> = awaitWriteResponse(
      'UpdateWorkspace',
      send,
      workspaceChangedTo({ name: 'Acme Corp' }),
    )
      .then(() => { settled = true; })
      .catch(() => { settled = true; });

    // A concurrent GetWorkspace answers with the CURRENT name.
    emitLater({ Workspace: { id: 'w-1', name: 'Acme' } });
    await new Promise((r) => setTimeout(r, 10));

    expect(settled, 'a read of the pre-rename workspace resolved the rename').toBe(false);

    eventEmitter.emit('workspace:raw-response', { Workspace: { id: 'w-1', name: 'Acme Corp' } });
    await pending;
  });

  it('is resolved by the answer carrying the new name', async () => {
    const send: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
    const pending: Promise<void> = awaitWriteResponse(
      'UpdateWorkspace',
      send,
      workspaceChangedTo({ name: 'Acme Corp' }),
    );

    emitLater({ Workspace: { id: 'w-1', name: 'Acme Corp' } });

    await expect(pending).resolves.toBeUndefined();
  });

  it('is not resolved by another workspace answering a theme write', async () => {
    const send: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
    let settled: boolean = false;

    const pending: Promise<void> = awaitWriteResponse(
      'UpdateWorkspaceTheme',
      send,
      workspaceWithId('w-mine'),
    )
      .then(() => { settled = true; })
      .catch(() => { settled = true; });

    emitLater({ Workspace: { id: 'w-theirs', name: 'someone else' } });
    await new Promise((r) => setTimeout(r, 10));

    expect(settled, "another workspace's broadcast resolved this theme write").toBe(false);

    eventEmitter.emit('workspace:raw-response', { Workspace: { id: 'w-mine' } });
    await pending;
  });

  it('narrows nothing when the request changes nothing it can name', () => {
    // A metadata-only update has no discriminator, and inventing one that
    // accepts everything would be worse than the type-only match it replaces.
    // Stated here so the gap is a decision rather than an oversight.
    expect(workspaceChangedTo({})).toBeUndefined();
  });
});
