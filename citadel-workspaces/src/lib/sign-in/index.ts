/** Composition root: the sign-in deps wired to the browser and the agent. */
import * as wsModule from '../websocket-service';
import { agentPasskeyStore } from '@/lib/passkey/agent-store';
import { createBrowserAuthenticator, readClientCapabilities } from '@/lib/passkey/browser-authenticator';
import { RP_NAME, resolveRpId } from '@/lib/passkey/rp-id';
import type { PasskeyStore } from '@/lib/passkey/repository';
import type { EnrolDeps } from './enrol-key';

export interface SignInDeps extends EnrolDeps {
  /** The agent's CID-0 LocalDB: public sign-in hints and legacy records only. */
  store: PasskeyStore;
}

export function browserSignInDeps(): SignInDeps {
  return {
    authenticator: createBrowserAuthenticator(window.navigator.credentials, readClientCapabilities()),
    rpId: resolveRpId(window.location.hostname),
    rpName: RP_NAME,
    // Namespace import, as agent-store.ts does, to stay out of the websocket-service import cycle.
    send: (request: Record<string, unknown>): Promise<void> => wsModule.websocketService.sendRequest(request),
    store: agentPasskeyStore,
  };
}

export { answerKeyChallenge, declineKeyChallenge, CANCELLED_REASON, type KeyAnswerResult } from './key-answer';
export { addSecurityKey } from './enrol-key';
export { manageSignIn, SignInManagementError } from './management';
export { openChallenges, settleChallenge, subscribeChallenges, touchWindowMs, watchKeyChallenges } from './challenge-watch';
export { connectFactorFields, passwordOnly, tenantOf } from './factors';
export { deleteHint, listHints, saveHint, type SignInHint } from './hints';
export type { AccountRef, SignInFactors, SignInPolicy, SignInCredential } from './types';
