/**
 * The post-quantum sign-in vocabulary (docs/plans/pq-sign-in.md), as the agent
 * speaks it. The wire types are generated from the agent's Rust; only the
 * shapes the UI composes from them are declared here.
 */
import type { SecurityKeyChallengeNotification as WireChallenge } from 'citadel-workspace-client-ts';

export type {
  SecurityKeyPurpose, SignInCredential, SignInManagementOp,
  SignInManagementOutcome, SignInPolicy, StepUp, FactorKind,
} from 'citadel-workspace-client-ts';

/**
 * A key challenge as it reaches this page. `expires_in_ms` is a u64, and the
 * WASM client turns every u64 into a BigInt, while the generated type says
 * `number`; arithmetic on it threw in the prompt's render. Typed as both, so
 * the compiler sends every reader through `touchWindowMs` (challenge-watch.ts).
 */
export type SecurityKeyChallengeNotification = Omit<WireChallenge, 'expires_in_ms'> & { expires_in_ms: number | bigint };

/**
 * What one Connect proves. The server, not the page, decides whether these
 * satisfy the account's policy; the page only says what it can offer.
 */
export interface SignInFactors {
  /** Null for a key-first or recovery-code sign-in. */
  password: string | null;
  /** This window can answer a SecurityKeyChallengeNotification (WebAuthn works here). */
  securityKey: boolean;
  /** A recovery code as typed: signs in once, to a restricted session. */
  recoveryCode: string | null;
  /** A Turnstile token for a workspace that asks for a human check; single-use. */
  admissionToken: string | null;
}

/** The three Connect fields the factors become. */
export interface ConnectFactorFields {
  password: number[] | null;
  security_key: boolean;
  recovery_code: number[] | null;
  admission_token: string | null;
}

/** Who a sign-in record or a key belongs to. A tenant is the server the account lives on. */
export interface AccountRef {
  tenant: string;
  cid: bigint;
  username: string;
}
