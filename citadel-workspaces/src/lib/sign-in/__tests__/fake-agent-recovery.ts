/**
 * The fake agent's recovery side (split from fake-agent.ts for length): an account's factors as
 * the server lists them, its 24-word phrase, what a recovery console session may do, and the
 * `RecoverAccount` answers, in the order the Rust agent sends them.
 */
import { BIP39_ENGLISH } from '@/lib/sign-in-with-citadel/bip39-english';
import type { SignInCredential, SignInManagementOp } from '../types';
import type { FakeAccount } from './fake-agent';

/** A deterministic 24-word phrase of real recovery words: a different one per `seed`. */
export function fakePhrase(seed: number): string[] {
  return Array.from({ length: 24 }, (_v: unknown, i: number) => BIP39_ENGLISH[(seed * 97 + i * 13 + 5) % 2048]);
}

/** A `SignInManagementOp` variant's name, derived from the generated type. */
type OpName<T = SignInManagementOp> = T extends string ? T : keyof T;

/** The SDK's `allowed_in_recovery`: the ops a recovery session may run, a subset of every op. */
export const CONSOLE_OPS: ReadonlySet<string> = new Set<OpName>([
  'ListCredentials', 'AddSecurityKey', 'RemoveCredential', 'SetSignInPolicy', 'SetPassword', 'RegenerateRecoveryPhrase',
] satisfies readonly OpName[]);

/** The agent's refusal (kernel/sign_in/recovery.rs RECOVERY_ONLY). */
export const RECOVERY_ONLY: string =
  'This session signed in to recover the account: it can only manage how the account signs in, or sign out';

/** Every factor, with the server's `null`s; `wire` drops them as a Rust `None` is dropped (wasm-none-is-undefined). */
export function listCredentials(account: FakeAccount, wire: boolean): SignInCredential[] {
  const password: SignInCredential[] = account.policy === 'KeyOnly' ? [] : [{
    id: 1, kind: 'Password', label: 'Password', credential_id: null, created_ms: 1n, last_used_ms: null, consumed: false,
  }];
  const phrase: SignInCredential[] = account.phrase.length === 0 ? [] : [{
    id: 2, kind: 'RecoveryPhrase', label: 'Recovery phrase', credential_id: null, created_ms: 1n, last_used_ms: null, consumed: false,
  }];
  const all: SignInCredential[] = [...password, ...account.keys.map((k): SignInCredential => ({
    id: k.id, kind: 'SecurityKey', label: k.label, credential_id: k.credentialId, created_ms: 2n, last_used_ms: null, consumed: false,
  })), ...phrase, ...account.recoveryCodes.map((c: string, i: number): SignInCredential => ({
    id: 100 + i, kind: 'RecoveryCode', label: `Recovery code ${i + 1}`, credential_id: null, created_ms: 1n, last_used_ms: null, consumed: account.consumed.includes(c),
  }))];
  if (!wire) return all;
  return all.map((c: SignInCredential): SignInCredential => {
    const out: Partial<SignInCredential> = { ...c };
    if (c.credential_id === null) delete out.credential_id;
    if (c.last_used_ms === null) delete out.last_used_ms;
    return out as SignInCredential;
  });
}

/** Whether `typed` is the account's phrase, in any case and spacing. */
export const isPhraseOf = (account: FakeAccount, typed: string): boolean =>
  account.phrase.length > 0 && typed.trim().toLowerCase().split(/\s+/).join(' ') === account.phrase.join(' ');

export interface RecoverySide {
  readonly accounts: FakeAccount[];
  readonly recoverySessions: Set<bigint>;
  emit: (variant: string, body: Record<string, unknown>) => void;
  text: (bytes: unknown) => string | null;
}

/**
 * `RecoverAccount`: refused alike for an unknown name and a wrong phrase. An account this device
 * does not hold is recovered first (`RecoverAccountSuccess`, other devices revoked); then the phrase
 * sign-in's `ConnectSuccess`, a console session.
 */
export function recoverAccount(agent: RecoverySide, body: Record<string, unknown>): void {
  const requestId: string = body.request_id as string;
  const account: FakeAccount | undefined = agent.accounts.find((a) => a.username === body.username && a.server === body.server_addr);
  if (!account || !isPhraseOf(account, agent.text(body.phrase) ?? '')) {
    agent.emit('RecoverAccountFailure', { cid: 0n, request_id: requestId, message: 'authentication failed' });
    return;
  }
  if (!account.heldHere) {
    account.heldHere = true;
    agent.emit('RecoverAccountSuccess', { cid: account.cid, request_id: requestId });
  }
  agent.recoverySessions.add(account.cid);
  agent.emit('ConnectSuccess', { cid: account.cid, request_id: requestId });
}
