/**
 * The Connect that connect_after_register could not make: on a workspace that
 * checks, the register token was spent on Register, so the agent's follow-up
 * Connect was refused with admission_required. This one carries a fresh
 * `sign-in` token, and answers a key challenge if the account asks for one.
 */
import * as wsModule from '@/lib/websocket-service';
import { awaitConnectOutcome, type ConnectOutcome } from '@/lib/connection/await-connect-outcome';
import { connectRefusal } from '@/lib/connection/connect-refusal';
import { passkeysAvailableHere } from '@/lib/passkey';
import { watchKeyChallenges } from '@/lib/sign-in/challenge-watch';
import type { SessionSecuritySettings } from '@/lib/security-utils';
import { resolveServerAddress } from '@/lib/address-resolver';

const CONNECT_TIMEOUT_MS: 30000 = 30000;

/**
 * Resolves with the session's CID; rejects with the server's reason (an AdmissionRefusal for the check).
 * `serverAddress` is the one registered to, normalised as Register normalised it, so it names the server
 * the agent recorded for the account.
 */
export async function connectAfterRegistration(
  username: string, serverAddress: string, password: string, admissionToken: string, settings: SessionSecuritySettings,
): Promise<bigint> {
  const server: string = await resolveServerAddress(serverAddress);
  const requestId: string = crypto.randomUUID();
  const outcome: Promise<ConnectOutcome> = awaitConnectOutcome(requestId, CONNECT_TIMEOUT_MS);
  const unwatch: () => void = watchKeyChallenges(requestId);
  try {
    try {
      await wsModule.websocketService.connect(requestId, username, server,
        { password, securityKey: passkeysAvailableHere(), recoveryCode: null, admissionToken }, settings);
    } catch (error) {
      const _unanswered: Promise<unknown> = outcome.catch((): undefined => undefined);
      throw error;
    }
    const answer: ConnectOutcome = await outcome;
    if (answer.kind !== 'failed') return answer.cid;
    throw connectRefusal(answer, username);
  } finally {
    unwatch();
  }
}
