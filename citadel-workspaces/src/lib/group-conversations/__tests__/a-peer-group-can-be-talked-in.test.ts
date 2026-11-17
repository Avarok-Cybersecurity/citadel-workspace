/**
 * A peer group could be created, invited to, left, kicked from, listed and
 * ended -- and not talked in.
 *
 * `group-requests.ts` had a wire call for every one of those and none for
 * sending a message. So `useGroupChat` sent through
 * `WorkspaceService.sendGroupMessage`, the workspace protocol, for BOTH kinds
 * of group. The server authorises that request by resolving the group id to the
 * node that owns the chat channel -- and a peer group is keyed `<cid>:<mgid>`,
 * owned by no node -- so every send came back:
 *
 *   Permission denied: not a member of this chat channel
 *
 * The server is right to refuse: it is not the workspace's channel. CI caught
 * it as `test:peer-group` passing registration, navigation and the chat tab,
 * then failing messaging in both directions.
 *
 * `InternalServiceRequest::GroupMessage { cid, message, group_key, request_id }`
 * has existed on the wire the whole time, with GroupMessageSuccess,
 * GroupMessageFailure and GroupMessageNotification all generated. Only the
 * client half was missing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: Array<Record<string, unknown>> = [];

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendMessage: async (request: Record<string, unknown>): Promise<void> => { sent.push(request); },
  },
}));

vi.mock('../../connection', () => ({
  connectionManager: { getConnectionInfo: (): { cid: bigint } => ({ cid: 7n }) },
}));

const { sendPeerGroupMessage } = await import('../group-requests');

describe('sending into a peer group', () => {
  beforeEach((): void => { sent.length = 0; });

  it('sends a GroupMessage keyed by the group, not a workspace request', async () => {
    await sendPeerGroupMessage('7:42', 'hello');

    expect(sent).toHaveLength(1);
    const request: Record<string, unknown> = sent[0];
    // Not SendGroupMessage: that one goes to the workspace server, which owns
    // node-backed chat channels and refuses everything else.
    expect(Object.keys(request)).toEqual(['GroupMessage']);
    const payload: { cid: bigint; group_key: { cid: bigint; mgid: bigint }; message: number[] } = request.GroupMessage as { cid: bigint; group_key: { cid: bigint; mgid: bigint }; message: number[] };
    expect(payload.cid).toBe(7n);
    expect(payload.group_key).toEqual({ cid: 7n, mgid: 42n });
  });

  it('carries the text as bytes the peer can decode back', async () => {
    await sendPeerGroupMessage('7:42', 'hello');

    const payload: { message: number[] } = sent[0].GroupMessage as { message: number[] };
    expect(new TextDecoder().decode(new Uint8Array(payload.message))).toContain('hello');
  });

  it("carries the owner's group name when one is given, and none otherwise", async () => {
    // GroupCreate and GroupInvite have no name field; this envelope is how
    // members learn what the owner called the group.
    const { decodeGroupMessage } = await import('../group-message-codec');
    await sendPeerGroupMessage('7:42', 'hello', undefined, 'Team 0924');
    await sendPeerGroupMessage('7:42', 'hello');
    const names: Array<string | undefined> = sent.map((request) => {
      const payload: { message: number[] } = request.GroupMessage as { message: number[] };
      return decodeGroupMessage(new Uint8Array(payload.message))?.group_name;
    });
    expect(names).toEqual(['Team 0924', undefined]);
  });

  it('refuses an id that is not a group key rather than sending nonsense', async () => {
    // A node-backed chat channel id reaching this path is a routing mistake,
    // and sending it as a group key would put a malformed request on the wire.
    await expect(sendPeerGroupMessage('some-node-channel-uuid', 'hello')).rejects.toThrow(/group id/i);
    expect(sent).toHaveLength(0);
  });
});
