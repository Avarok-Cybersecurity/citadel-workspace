/**
 * Everything the sign-in flow asks of the world, as ports (SBIO): the issuer over HTTP, the local
 * agent over its socket, the return POST that leaves the page, and randomness. The flow
 * (flow.ts) holds no I/O; adapters implement these for the browser, fakes for the tests.
 */
import type { IdentityOutcome, IdentityRefusal } from 'citadel-internal-service-wasm-client';
import type { AgentRequestBody } from '@/types/agent-request';
import type {
  ReturnAllowlist, SignInBeginRequest, SignInBeginResponse, SignInProveRequest, SignInProveResponse,
} from './issuer-wire';

/**
 * An issuer answer: its body, or the reason code it refused with (`unknown_client`,
 * `attempt_expired`, ...), `unreachable` when no answer came, `unexpected_answer` when the body
 * was not the contract's shape.
 */
export type IssuerAnswer<T> = { ok: true; value: T } | { ok: false; code: string };

export interface IssuerPort {
  allowlist(): Promise<IssuerAnswer<ReturnAllowlist>>;
  begin(body: SignInBeginRequest): Promise<IssuerAnswer<SignInBeginResponse>>;
  prove(body: SignInProveRequest): Promise<IssuerAnswer<SignInProveResponse>>;
}

/** The agent's `IdentitySuccess` outcome or `IdentityFailure` reason for one request. */
export type AgentAnswer =
  | { ok: true; outcome: IdentityOutcome }
  | { ok: false; reason: IdentityRefusal; message: string };

/** `IdentitySignChallenge`'s fields as the flow holds them: bytes as bytes, the password as typed. */
export type SignChallenge = Pick<AgentRequestBody<'IdentitySignChallenge'>, 'issuer' | 'aud'> & {
  nonce: Uint8Array;
  challenge: Uint8Array;
  password: string;
};

/**
 * The local agent's identity requests. `status` resolves null when no agent answered within
 * `timeoutMs` (not installed, not running, or refusing this origin); the others reject when the
 * socket is lost or the agent does not answer in time.
 */
export interface AgentPort {
  status(timeoutMs: number): Promise<AgentAnswer | null>;
  create(password: string): Promise<AgentAnswer>;
  exportPhrase(password: string): Promise<AgentAnswer>;
  signChallenge(request: SignChallenge): Promise<AgentAnswer>;
}

/** `ReturnPost` (§1 step 3): `{code, state}` form-encoded to `action`. Leaves the page. */
export interface ReturnPort {
  post(action: string, fields: { code: string; state: string }): void;
}

export interface SignInPorts {
  issuer: IssuerPort;
  agent: AgentPort;
  returner: ReturnPort;
  /** A uniform integer in `[0, bound)`, from the CSPRNG. */
  randomIndex: (bound: number) => number;
}
