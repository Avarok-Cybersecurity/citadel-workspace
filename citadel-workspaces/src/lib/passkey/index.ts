/** Composition root: the passkey deps wired to the browser and the agent. */
import { createBrowserAuthenticator, readClientCapabilities } from './browser-authenticator';
import { agentPasskeyStore } from './agent-store';
import { RP_NAME, resolveRpId, webAuthnAvailable } from './rp-id';
import type { PasskeyDeps } from './unlock';

export function passkeysAvailableHere(): boolean {
  return typeof window !== 'undefined' && webAuthnAvailable(window);
}

export function browserPasskeyDeps(): PasskeyDeps {
  return {
    store: agentPasskeyStore,
    authenticator: createBrowserAuthenticator(window.navigator.credentials, readClientCapabilities()),
    rpId: resolveRpId(window.location.hostname),
    rpName: RP_NAME,
    now: (): number => Date.now(),
  };
}

export { PasskeyError, failureOf, type PasskeyFailure } from './authenticator';
export { signInWithPasskey, type PasskeyDeps } from './unlock';
export { hasPasskeyLogin, listCredentials, listPasskeyAccounts, removeCredential } from './repository';
export type { CredentialRecord } from './records';
