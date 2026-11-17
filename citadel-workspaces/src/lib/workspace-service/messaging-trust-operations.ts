/**
 * The messaging trust policy on the workspace protocol: who connects without asking.
 *
 * Every request is answered with `WorkspaceProtocolResponse::MessagingTrust`; each call here
 * resolves with the kind it asked for and rejects with the server's refusal. The protocol has no
 * request id, so a trust answer is taken for ours only when it names the peer we asked about.
 */
import type {
  MessagingTrustPolicy, MessagingTrustRequest, MessagingTrustResponse, MessagingTrustSettings,
} from 'citadel-workspace-client-ts';
import { awaitWriteResponse } from './await-write-response';
import type { ProtocolSender } from './workspace-operations';

/** The server's answer about one peer. */
export interface PeerTrust {
  /** The caller takes the peer without asking, and registers with them unprompted. */
  trusted: boolean;
  /** The peer's client takes the caller without asking. */
  peerTrustsCaller: boolean;
}

function settingsOf(payload: unknown): MessagingTrustSettings | null {
  if (!payload || typeof payload !== 'object' || !('Settings' in payload)) return null;
  return (payload as Extract<MessagingTrustResponse, { Settings: MessagingTrustSettings }>).Settings;
}

function peerTrustOf(payload: unknown, peerUsername: string): PeerTrust | null {
  if (!payload || typeof payload !== 'object' || !('PeerTrust' in payload)) return null;
  const answer: Extract<MessagingTrustResponse, { PeerTrust: unknown }>['PeerTrust'] =
    (payload as Extract<MessagingTrustResponse, { PeerTrust: unknown }>).PeerTrust;
  if (answer.peer_username !== peerUsername) return null;
  return { trusted: answer.trusted, peerTrustsCaller: answer.peer_trusts_caller };
}

async function exchange<T>(
  sender: ProtocolSender,
  request: MessagingTrustRequest,
  read: (payload: unknown) => T | null,
): Promise<T> {
  let answered: T | null = null;
  await awaitWriteResponse('MessagingTrust', () => sender.sendProtocolRequest({ MessagingTrust: request }), (payload: unknown): boolean => {
    answered = read(payload);
    return answered !== null;
  });
  if (answered === null) throw new Error('MessagingTrust: the server\'s answer did not carry what was asked for');
  return answered;
}

export const getMessagingTrustSettings = (s: ProtocolSender): Promise<MessagingTrustSettings> =>
  exchange(s, 'GetMessagingTrustSettings', settingsOf);

export const setWorkspaceMessagingTrust = (s: ProtocolSender, policy: MessagingTrustPolicy): Promise<MessagingTrustSettings> =>
  exchange(s, { SetWorkspaceMessagingTrust: { policy } }, settingsOf);

/** `null` follows the workspace. */
export const setMyMessagingTrust = (s: ProtocolSender, policy: MessagingTrustPolicy | null): Promise<MessagingTrustSettings> =>
  exchange(s, { SetMyMessagingTrust: { policy } }, settingsOf);

export const checkMessagingTrust = (s: ProtocolSender, peerUsername: string): Promise<PeerTrust> =>
  exchange(s, { CheckMessagingTrust: { peer_username: peerUsername } }, (payload: unknown): PeerTrust | null => peerTrustOf(payload, peerUsername));
