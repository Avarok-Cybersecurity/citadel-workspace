/**
 * The post-quantum sign-in vocabulary (docs/plans/pq-sign-in.md), as the agent
 * speaks it. The wire types are generated from the agent's Rust; only the
 * shapes the UI composes from them are declared here.
 */
import type { AgentRequestBody } from '@/types/agent-request';

/**
 * `SecurityKeyChallengeNotification.expires_in_ms` is a u64, a BigInt from the WASM client, and
 * the generated type says so: arithmetic on it does not compile, so every reader goes through
 * `touchWindowMs` (challenge-watch.ts).
 */
export type {
  SecurityKeyChallengeNotification,
  SecurityKeyPurpose, SignInCredential, SignInManagementOp,
  SignInManagementOutcome, SignInPolicy, StepUp, FactorKind,
} from 'citadel-workspace-client-ts';

/**
 * What one Connect proves. The server, not the page, decides whether these
 * satisfy the account's policy; the page only says what it can offer.
 */
export interface SignInFactors {
  /** Null for a key-first sign-in. */
  password: string | null;
  /** This window can answer a SecurityKeyChallengeNotification (WebAuthn works here). */
  securityKey: boolean;
  /** A Turnstile token for a workspace that asks for a human check; single-use. */
  admissionToken: string | null;
}

/** The Connect fields the factors become. */
export type ConnectFactorFields = Required<Pick<AgentRequestBody<'Connect'>, 'password' | 'security_key' | 'admission_token'>>;

/** Who a sign-in record or a key belongs to. A tenant is the server the account lives on. */
export interface AccountRef {
  tenant: string;
  cid: bigint;
  username: string;
}
