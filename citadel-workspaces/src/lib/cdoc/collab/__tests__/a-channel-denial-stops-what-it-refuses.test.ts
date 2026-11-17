/**
 * A chat document's refusals are its channel's, and arrive addressed to it rather than as the
 * page's plain `Error`. A denied send stops the document's writing, as EditMdx does a page's;
 * a denied read does not, because a write refusal and a read refusal guard different halves.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentsResponse } from 'citadel-workspace-client-ts';
import type { EditorSession } from '../../editor/editor-session';
import { accessOf, accessOfError } from '../denied-access';
import { BOB, NODE, newDocument, openTab, type Tab } from './doubles/harness';
import { realReplicas, typeInto } from './doubles/real-replicas';

type RealTab = Tab<EditorSession>;

const denied = (permission: 'SendMessages' | 'ViewContent'): DocumentsResponse => ({ Refused: { ChatDocumentDenied: { node_id: NODE, permission } } });

describe('a chat document refused by its channel', () => {
  it('stops writing when sending is refused, and says which permission', async () => {
    const { kernel, clock } = await newDocument({});
    const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
    await bob.session.open();
    await kernel.settle([bob.session]);
    // Held so the edit is still out when the channel's refusal arrives.
    kernel.holdBack(BOB, 'AppendRateLimited', 1);
    await typeInto(bob.replica(), 'x');
    await kernel.settle([bob.session]);
    kernel.inject(BOB, denied('SendMessages'));
    await kernel.settle([bob.session]);
    expect(bob.problems.map((p) => p.problem)).toEqual([{ kind: 'permissionDenied', message: 'Permission denied: SendMessages required' }]);
  });

  it('takes a refused read for a read: with no read out, nothing it was doing is refused', async () => {
    const { kernel, clock } = await newDocument({});
    const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
    await bob.session.open();
    await kernel.settle([bob.session]);
    // An edit still out: were the read refusal taken for a write one, it would stop it.
    kernel.holdBack(BOB, 'AppendRateLimited', 1);
    await typeInto(bob.replica(), 'x');
    await kernel.settle([bob.session]);
    kernel.inject(BOB, denied('ViewContent'));
    await kernel.settle([bob.session]);
    expect(bob.problems).toEqual([]);
  });
});

describe('which half a refused permission guards', () => {
  it('is one map for the page and for a chat document', () => {
    expect([accessOf('EditMdx'), accessOf('SendMessages'), accessOf('ViewContent'), accessOf('ManageNodeMembers')]).toEqual(['write', 'write', 'read', null]);
    expect(accessOfError('Permission denied: EditMdx required')).toBe('write');
    expect(accessOfError('Permission denied: ViewContent required')).toBe('read');
    expect(accessOfError('Permission denied: not a member of this chat channel')).toBeNull();
  });
});
