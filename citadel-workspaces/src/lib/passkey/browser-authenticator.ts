/**
 * The production AuthenticatorPort, over `navigator.credentials`.
 *
 * The option builders are exported and pure so the parameters that carry the
 * security decisions -- UV required, resident key required, PRF requested,
 * existing keys excluded -- are asserted by a test rather than trusted.
 */
import { type Bytes, copyBytes, toBase64Url } from './bytes';
import {
  type Assertion, type AuthenticatorPort, type CreateCeremony, type CreatedCredential,
  type GetCeremony, PasskeyError,
} from './authenticator';

/** ES256, EdDSA, then RS256 as the last resort. */
const PUB_KEY_ALGORITHMS: readonly number[] = [-7, -8, -257];

export function buildCreationOptions(c: CreateCeremony): PublicKeyCredentialCreationOptions {
  return {
    rp: { id: c.rpId, name: c.rpName },
    user: { id: c.userHandle, name: c.userName, displayName: c.userDisplayName },
    challenge: c.challenge,
    pubKeyCredParams: PUB_KEY_ALGORITHMS.map((alg) => ({ type: 'public-key', alg })),
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    excludeCredentials: c.excludeCredentialIds.map((id) => ({ type: 'public-key', id })),
    attestation: 'none',
    extensions: { prf: { eval: { first: c.prfSalt } } },
  };
}

export function buildRequestOptions(c: GetCeremony): PublicKeyCredentialRequestOptions {
  const evalByCredential: Record<string, AuthenticationExtensionsPRFValues> = {};
  for (const allowed of c.allow) evalByCredential[toBase64Url(allowed.id)] = { first: allowed.prfSalt };
  return {
    rpId: c.rpId,
    challenge: c.challenge,
    userVerification: 'required',
    allowCredentials: c.allow.map((a) => ({
      type: 'public-key', id: a.id, transports: a.transports as AuthenticatorTransport[],
    })),
    extensions: { prf: { evalByCredential } },
  };
}

const prfFirst = (results: AuthenticationExtensionsPRFValues | undefined): Bytes | null =>
  results?.first ? copyBytes(results.first) : null;

function mapCeremonyError(error: unknown, onCreate: boolean): PasskeyError {
  // Read by shape: a DOMException is not `instanceof Error` in every realm.
  const name: unknown = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  if (name === 'NotAllowedError' || name === 'AbortError') return new PasskeyError('cancelled');
  if (onCreate && name === 'InvalidStateError') return new PasskeyError('already-enrolled');
  if (name === 'NotSupportedError' || name === 'SecurityError') return new PasskeyError('unsupported');
  return new PasskeyError('failed');
}

function asPublicKeyCredential(value: Credential | null): PublicKeyCredential {
  if (!value || value.type !== 'public-key') throw new PasskeyError('failed');
  return value as PublicKeyCredential;
}

/** The browser's `PublicKeyCredential.getClientCapabilities`, or null where it does not exist. */
export type ClientCapabilities = (() => Promise<Record<string, boolean>>) | null;

export function readClientCapabilities(): ClientCapabilities {
  const read: (() => Promise<Record<string, boolean>>) | undefined = typeof PublicKeyCredential === 'undefined'
    ? undefined
    : (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities;
  return read ? (): Promise<Record<string, boolean>> => read.call(PublicKeyCredential) : null;
}

export function createBrowserAuthenticator(credentials: CredentialsContainer, capabilities: ClientCapabilities): AuthenticatorPort {
  return {
    async prfRuledOut(): Promise<boolean> {
      if (capabilities === null) return false;
      try {
        return (await capabilities())['extension:prf'] === false;
      } catch {
        // Not knowing is not a "no": the ceremony's own PRF result still decides.
        return false;
      }
    },

    async create(ceremony: CreateCeremony): Promise<CreatedCredential> {
      let credential: PublicKeyCredential;
      try {
        credential = asPublicKeyCredential(await credentials.create({ publicKey: buildCreationOptions(ceremony) }));
      } catch (error) {
        throw error instanceof PasskeyError ? error : mapCeremonyError(error, true);
      }
      const response: AuthenticatorAttestationResponse = credential.response as AuthenticatorAttestationResponse;
      const spki: ArrayBuffer | null = response.getPublicKey?.() ?? null;
      const prf: AuthenticationExtensionsPRFOutputs | undefined = credential.getClientExtensionResults().prf;
      return {
        credentialId: copyBytes(credential.rawId),
        transports: response.getTransports?.() ?? [],
        publicKeySpki: spki ? copyBytes(spki) : null,
        publicKeyAlgorithm: response.getPublicKeyAlgorithm?.() ?? 0,
        attestationObject: copyBytes(response.attestationObject),
        prf: { enabled: prf?.enabled, first: prfFirst(prf?.results) },
      };
    },

    async get(ceremony: GetCeremony): Promise<Assertion> {
      let credential: PublicKeyCredential;
      try {
        credential = asPublicKeyCredential(await credentials.get({ publicKey: buildRequestOptions(ceremony) }));
      } catch (error) {
        throw error instanceof PasskeyError ? error : mapCeremonyError(error, false);
      }
      return {
        credentialId: copyBytes(credential.rawId),
        prfFirst: prfFirst(credential.getClientExtensionResults().prf?.results),
      };
    },

    async signalUnknownCredential(rpId: string, credentialId: Bytes): Promise<void> {
      const signal: ((o: { rpId: string; credentialId: string }) => Promise<void>) | undefined =
        (PublicKeyCredential as unknown as {
          signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void>;
        }).signalUnknownCredential;
      if (signal) await signal.call(PublicKeyCredential, { rpId, credentialId: toBase64Url(credentialId) });
    },
  };
}
