/**
 * "Sign in with Citadel", the page's side (sign-in-with-citadel.md §1-§1a, §8): validate the link,
 * probe the agent, create an identity if there is none, begin an attempt, ask consent, have the
 * agent sign the issuer's challenge, prove it, and POST the code to the client's return.
 *
 * Business logic only (SBIO): every effect goes through `SignInPorts`. The password is passed
 * through to the agent and never kept in a state.
 */
import { fromBase64Url } from '@/lib/passkey/bytes';
import { notifyEach } from '@/lib/notify-listeners';
import type { IdentityOutcome } from 'citadel-internal-service-wasm-client';
import { allowlistedClient, parseSignInLink, type LinkCheck, type SignInLink } from './link';
import { matchWords } from './match-phrase';
import { ANSWERABLE_IN_DIALOG, RESTARTABLE, type Accepted, type SignInState } from './flow-state';
import { phraseChecks, phraseMatches } from './phrase-check';
import type { AgentAnswer, SignInPorts } from './ports';
import type { AllowlistedClient, ReturnAllowlist } from './issuer-wire';

/** `sign-in-kat.json` `proof_constants`: how long the page waits for the agent before "install it". */
export const AGENT_PROBE_MS: number = 3000;

type Listener = (state: SignInState) => void;

export class SignInFlow {
  private current: SignInState = { step: 'loading' };
  private started: boolean = false;
  private readonly listeners: Set<Listener> = new Set();

  constructor(private readonly ports: SignInPorts) {}

  get state(): SignInState {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return (): void => { this.listeners.delete(listener); };
  }

  /** Validate the link in `search`; nothing reaches the agent or the issuer's attempt store before it passes. */
  async start(search: string): Promise<void> {
    // Once per flow: a second start (React's development double effect) would begin a second attempt.
    if (this.started) return;
    this.started = true;
    const parsed: LinkCheck<SignInLink> = parseSignInLink(search);
    if (!parsed.ok) return this.set({ step: 'refused', reason: parsed.reason });
    const allowlist: Awaited<ReturnType<SignInPorts['issuer']['allowlist']>> = await this.ports.issuer.allowlist();
    if (!allowlist.ok) return this.set({ step: 'unavailable', code: allowlist.code });
    const client: LinkCheck<AllowlistedClient> = allowlistedClient(parsed.value, allowlist.value satisfies ReturnAllowlist);
    if (!client.ok) return this.set({ step: 'refused', reason: client.reason });
    const challenge: Uint8Array | null = fromBase64Url(parsed.value.challenge);
    if (challenge === null) return this.set({ step: 'refused', reason: 'malformed_link' });
    await this.probe({ link: parsed.value, client: client.value, words: matchWords(challenge) });
  }

  /** "Retry" on the no-agent screen, or the agent's socket coming up while it shows. */
  async retry(): Promise<void> {
    if (this.current.step === 'no-agent') await this.probe(this.accepted());
  }

  /** "Create an identity": seal a new one under `password`, then show its recovery phrase to confirm. */
  async createIdentity(password: string): Promise<void> {
    if (this.current.step !== 'no-identity' || this.current.busy) return;
    const base: Accepted = this.accepted();
    this.set({ step: 'no-identity', ...base, busy: true, error: null });
    const created: AgentAnswer | null = await this.ask(() => this.ports.agent.create(password));
    if (created === null) return;
    const idFp: string | null = outcomeFingerprint(created);
    if (idFp === null) return this.failWith(created);
    const exported: AgentAnswer | null = await this.ask(() => this.ports.agent.exportPhrase(password));
    if (exported === null) return;
    if (!exported.ok || typeof exported.outcome !== 'object' || !('Exported' in exported.outcome)) return this.failWith(exported);
    const phrase: string[] = exported.outcome.Exported.phrase;
    this.set({ step: 'confirm-phrase', ...base, idFp, phrase, checks: phraseChecks(phrase.length, this.ports.randomIndex), error: null });
  }

  /** The words the person typed for the checked positions; a match moves on to the sign-in. */
  async confirmPhrase(answers: string[]): Promise<void> {
    const state: SignInState = this.current;
    if (state.step !== 'confirm-phrase') return;
    if (!phraseMatches(state.phrase, state.checks, answers)) {
      return this.set({ ...state, error: 'Those words do not match your recovery phrase. Check what you wrote down.' });
    }
    await this.begin(state.idFp);
  }

  /** Approve in the consent dialog: the agent signs, the issuer verifies, the code goes to the return. */
  async approve(password: string): Promise<void> {
    const state: SignInState = this.current;
    if (state.step !== 'consent' || state.busy || password.length === 0) return;
    this.set({ ...state, busy: true, error: null });
    const nonce: Uint8Array | null = fromBase64Url(state.begun.nonce);
    const challenge: Uint8Array | null = fromBase64Url(state.link.challenge);
    if (nonce === null || challenge === null) return this.fail('unexpected_answer');
    const signed: AgentAnswer | null = await this.ask(() => this.ports.agent.signChallenge({
      issuer: state.begun.issuer, aud: state.begun.aud, nonce, challenge, password,
    }));
    if (signed === null) return;
    if (!signed.ok) {
      if (ANSWERABLE_IN_DIALOG.has(signed.reason)) return this.set({ ...state, busy: false, error: signed.reason });
      if (signed.reason === 'no_identity') return this.set({ step: 'no-identity', ...this.accepted(), busy: false, error: null });
      return this.fail(signed.reason);
    }
    if (typeof signed.outcome !== 'object' || !('SignedChallenge' in signed.outcome)) return this.fail('unexpected_answer');
    const proven: Awaited<ReturnType<SignInPorts['issuer']['prove']>> = await this.ports.issuer.prove({
      v: 1, attempt: state.begun.attempt, proof: signed.outcome.SignedChallenge.proof,
    });
    if (!proven.ok) return this.fail(proven.code);
    // The issuer echoes the link's return and state; anything else is not this attempt's, and is never posted.
    if (proven.value.return !== state.link.return || proven.value.state !== state.link.state) return this.fail('return_mismatch');
    this.set({ step: 'returning', ...this.accepted(), action: proven.value.return });
    this.ports.returner.post(proven.value.return, { code: proven.value.code, state: proven.value.state });
  }

  /** Cancel: nothing is posted anywhere; the attempt expires at the issuer on its own. */
  cancel(): void {
    const state: SignInState = this.current;
    const idle: boolean = (state.step === 'consent' || state.step === 'no-identity') ? !state.busy : state.step === 'confirm-phrase';
    if (idle) this.set({ step: 'cancelled' });
  }

  /** "Start again" after a restartable refusal: a new attempt for the same link. */
  async restart(): Promise<void> {
    if (this.current.step !== 'failed' || !this.current.restartable) return;
    await this.probe(this.accepted());
  }

  private async probe(base: Accepted): Promise<void> {
    this.set({ step: 'looking-for-agent', ...base });
    const status: AgentAnswer | null = await this.ports.agent.status(AGENT_PROBE_MS).catch((): null => null);
    if (status === null) return this.set({ step: 'no-agent', ...base });
    if (!status.ok) return this.fail(status.reason);
    const outcome: IdentityOutcome = status.outcome;
    if (typeof outcome !== 'object' || !('Status' in outcome)) return this.fail('unexpected_answer');
    const held: typeof outcome.Status.state = outcome.Status.state;
    if (held === 'None') return this.set({ step: 'no-identity', ...base, busy: false, error: null });
    await this.begin('Locked' in held ? held.Locked.id_fp : held.Unlocked.id_fp);
  }

  private async begin(idFp: string): Promise<void> {
    const base: Accepted = this.accepted();
    this.set({ step: 'beginning', ...base, idFp });
    const begun: Awaited<ReturnType<SignInPorts['issuer']['begin']>> = await this.ports.issuer.begin({
      v: 1, client: base.link.client, challenge: base.link.challenge, state: base.link.state, return: base.link.return,
    });
    if (!begun.ok) return this.fail(begun.code);
    // aud is the allowlist's (SSOT): an issuer naming another audience is not answering this link.
    if (begun.value.aud !== base.client.aud) return this.fail('unexpected_answer');
    this.set({ step: 'consent', ...base, idFp, begun: begun.value, busy: false, error: null });
  }

  /** An agent call that may reject (socket lost, no answer): null after moving to `failed`. */
  private async ask(call: () => Promise<AgentAnswer>): Promise<AgentAnswer | null> {
    try {
      return await call();
    } catch {
      this.fail('agent_lost');
      return null;
    }
  }

  private failWith(answer: AgentAnswer): void {
    this.fail(answer.ok ? 'unexpected_answer' : answer.reason);
  }

  private fail(code: string): void {
    this.set({ step: 'failed', ...this.accepted(), code, restartable: RESTARTABLE.has(code) });
  }

  private accepted(): Accepted {
    const state: SignInState = this.current;
    if (!('link' in state)) throw new Error(`no accepted link in step ${state.step}`);
    return { link: state.link, client: state.client, words: state.words };
  }

  private set(next: SignInState): void {
    this.current = next;
    notifyEach(this.listeners, 'sign-in flow', next);
  }
}

function outcomeFingerprint(answer: AgentAnswer): string | null {
  if (!answer.ok || typeof answer.outcome !== 'object' || !('Created' in answer.outcome)) return null;
  return answer.outcome.Created.id_fp;
}
