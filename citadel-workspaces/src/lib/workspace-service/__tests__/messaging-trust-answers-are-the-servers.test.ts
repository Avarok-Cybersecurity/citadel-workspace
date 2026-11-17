/**
 * The messaging trust requests resolve with what the SERVER answered, and a trust answer is ours
 * only when it names the peer we asked about: the protocol carries no request id, and two checks
 * in flight at once (an incoming request while a chat opens) must not take each other's answer.
 *
 * Doubled: the send (the wire) and the inbound event, as every write-gate test here does.
 */
import { describe, expect, it, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import type { MessagingTrustSettings } from 'citadel-workspace-client-ts';
import { checkMessagingTrust, getMessagingTrustSettings, setMyMessagingTrust, setWorkspaceMessagingTrust } from '../messaging-trust-operations';
import type { ProtocolSender } from '../workspace-operations';

type Sender = ProtocolSender & { sent: WorkspaceProtocolRequestTS[] };

function sender(answers: unknown[]): Sender {
  const sent: WorkspaceProtocolRequestTS[] = [];
  return {
    sent,
    currentCid: 7n,
    sendProtocolRequest: vi.fn(async (request: WorkspaceProtocolRequestTS): Promise<void> => {
      sent.push(request);
      for (const response of answers) setTimeout(() => eventEmitter.emit('workspace:raw-response', response), 0);
    }),
  };
}

const SETTINGS: MessagingTrustSettings = { workspace: 'AllTrusted', mine: 'Strict', effective_root: null };

describe('the messaging trust requests', () => {
  it('check: takes the answer about OUR peer, not one about somebody else', async () => {
    const s: Sender = sender([
      { MessagingTrust: { PeerTrust: { peer_username: 'someone-else', trusted: true, peer_trusts_caller: true } } },
      { MessagingTrust: { PeerTrust: { peer_username: 'bob', trusted: false, peer_trusts_caller: true } } },
    ]);
    expect(await checkMessagingTrust(s, 'bob')).toEqual({ trusted: false, peerTrustsCaller: true });
    expect(s.sent).toEqual([{ MessagingTrust: { CheckMessagingTrust: { peer_username: 'bob' } } }]);
  });

  it('settings: read and both writes resolve with the server\'s settings', async () => {
    expect(await getMessagingTrustSettings(sender([{ MessagingTrust: { Settings: SETTINGS } }]))).toEqual(SETTINGS);
    const workspace: Sender = sender([{ MessagingTrust: { Settings: SETTINGS } }]);
    await setWorkspaceMessagingTrust(workspace, { NodeLevelTrusted: { node_id: 'eng' } });
    expect(workspace.sent).toEqual([{ MessagingTrust: { SetWorkspaceMessagingTrust: { policy: { NodeLevelTrusted: { node_id: 'eng' } } } } }]);
    const mine: Sender = sender([{ MessagingTrust: { Settings: SETTINGS } }]);
    expect(await setMyMessagingTrust(mine, null)).toEqual(SETTINGS);
    expect(mine.sent).toEqual([{ MessagingTrust: { SetMyMessagingTrust: { policy: null } } }]);
  });

  it('rejects with the server\'s refusal', async () => {
    const s: Sender = sender([{ Error: 'Your own setting can only narrow the workspace\'s' }]);
    await expect(setMyMessagingTrust(s, 'AllTrusted')).rejects.toThrow('only narrow');
  });
});
