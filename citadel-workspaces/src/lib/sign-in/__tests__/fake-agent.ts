/**
 * A stand-in for the agent and the server behind it, answering on the app's
 * event emitter exactly as the real agent answers over the socket.
 *
 * Doubled because it is the I/O boundary: the real one is a WebSocket to a
 * local process talking post-quantum Citadel to a Durable Object, none of which
 * exists under vitest. It keeps the server's rules that the UI depends on --
 * the policy decides which factors a sign-in needs, a key is proved by the PRF
 * output it gave at enrolment, the phrase opens a
 * recovery console that may only manage how the account signs in, removing a
 * factor the policy needs is refused -- so a UI that skips a step fails here as
 * it would live.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { toBase64Url } from '@/lib/passkey/bytes';
import { FakeAdmission } from './fake-admission';
import { accepts, type Ceremony, FAKE_RP_ID } from './fake-ceremony';
import type { SignInPolicy } from '../types';
import { CONSOLE_OPS, fakePhrase, isPhraseOf, listCredentials, RECOVERY_ONLY, recoverAccount } from './fake-agent-recovery';

type Req = Record<string, unknown>;
const PRF_SALT: number[] = Array.from({ length: 32 }, (_v: unknown, i: number) => i + 1);
const TOUCH_WINDOW_MS: 60000 = 60000;
/** Where a fake account is registered unless a test says otherwise. */
export const FAKE_SERVER: string = 'bench.work.avarok.net';
export interface FakeAccount {
  username: string;
  cid: bigint;
  /** The server it is registered to; a Connect naming another is refused, as the agent refuses it. */
  server: string;
  password: string;
  policy: SignInPolicy;
  keys: Array<{ id: number; credentialId: number[]; label: string; prf: string }>;
  /** The 24-word recovery phrase. */
  phrase: string[];
  /** Whether this device holds the account's bundle: a RecoverAccount for one it does not recovers it here first. */
  heldHere: boolean;
}

interface Pending { requestId: string; resolve: (prf: { credentialId: number[]; prf: number[] } | string) => void; ceremony: Ceremony }

export class FakeAgent {
  readonly sent: Array<[string, Req]> = [];
  readonly accounts: FakeAccount[] = [];
  /** Recovery console sessions: opened by the phrase. */
  readonly recoverySessions: Set<bigint> = new Set<bigint>();
  /** The workspace's human-check requirement, enforced on Connect and Register. */
  readonly admission: FakeAdmission = new FakeAdmission();
  /** A 0.12.2 server: it names no relying party, and the SDK will not ask it to enrol a key. */
  serverAt0122: boolean = false;
  private readonly pending: Map<string, Pending> = new Map<string, Pending>();
  private nextFactor: number = 10;
  private nextPhrase: number = 0;

  account(username: string, policy: SignInPolicy = 'Password', cid: bigint = 7n): FakeAccount {
    const account: FakeAccount = {
      username, cid, server: FAKE_SERVER, password: 'correct horse battery', policy, keys: [],
      phrase: fakePhrase(this.accounts.length + 1), heldHere: true,
    };
    this.accounts.push(account);
    return account;
  }

  readonly send = async (request: Req): Promise<void> => {
    const [variant, body] = Object.entries(request)[0] as [string, Req];
    this.sent.push([variant, structuredClone(body)]);
    queueMicrotask(() => { void this.handle(variant, body); });
  };

  emit(variant: string, body: Req): void {
    eventEmitter.emit('websocket-message', { [variant]: body });
  }

  text(bytes: unknown): string | null {
    return Array.isArray(bytes) ? new TextDecoder().decode(Uint8Array.from(bytes as number[])) : null;
  }

  /** Ask the window for a touch; resolves with its answer or the decline reason. */
  private challenge(requestId: string, cid: bigint, purpose: string, ceremony: Ceremony): Promise<{ credentialId: number[]; prf: number[] } | string> {
    const challengeId: string = crypto.randomUUID();
    return new Promise((resolve) => {
      this.pending.set(challengeId, { requestId, resolve, ceremony });
      this.emit('SecurityKeyChallengeNotification', {
        cid, request_id: requestId, challenge_id: challengeId, purpose, ceremony, ...(this.serverAt0122 ? {} : { rp_id: FAKE_RP_ID }),
        // A u64, which the WASM client hands to JavaScript as a BigInt (serialize_large_number_types_as_bigints).
        prf_salt: PRF_SALT, expires_in_ms: BigInt(TOUCH_WINDOW_MS),
      });
    });
  }

  private async proveKey(account: FakeAccount, requestId: string, cid: bigint, purpose: string): Promise<string | null> {
    const answer: { credentialId: number[]; prf: number[] } | string =
      await this.challenge(requestId, cid, purpose, { Authenticate: { credential_ids: account.keys.map((k) => k.credentialId) } });
    if (typeof answer === 'string') return answer;
    const key: FakeAccount['keys'][number] | undefined =
      account.keys.find((k) => toBase64Url(Uint8Array.from(k.credentialId)) === toBase64Url(Uint8Array.from(answer.credentialId)));
    return key && key.prf === toBase64Url(Uint8Array.from(answer.prf)) ? null : 'authentication failed';
  }

  private async handle(variant: string, body: Req): Promise<void> {
    const requestId: string = body.request_id as string;
    if (variant === 'SecurityKeyAnswer' || variant === 'SecurityKeyDecline') return this.answer(variant, body);
    if (variant === 'Register') return this.register(body);
    if (variant === 'Connect') return this.connect(body);
    if (variant === 'GetAccountInformation') return this.emit('GetAccountInformationResponse', { request_id: requestId, accounts: Object.fromEntries(
      this.accounts.map((a) => [a.cid.toString(), { username: a.username, full_name: a.username, peers: {}, server_host: a.server }])) });
    if (variant === 'SignInManagement') return this.manage(body);
    if (variant === 'RecoverAccount') return recoverAccount(this, body);
    if (variant === 'Disconnect') { this.recoverySessions.delete(body.cid as bigint); this.emit('DisconnectSuccess', { cid: body.cid, request_id: requestId }); }
  }

  private answer(variant: string, body: Req): void {
    const open: Pending | undefined = this.pending.get(body.challenge_id as string);
    const reply = (ok: boolean, message: string): void => this.emit(ok ? 'SecurityKeyAnswerSuccess' : 'SecurityKeyAnswerFailure',
      { cid: 0n, request_id: body.request_id, challenge_id: body.challenge_id, ...(ok ? {} : { message }) });
    if (!open) { reply(false, 'The challenge is not open'); return; }
    if (variant === 'SecurityKeyDecline') { this.pending.delete(body.challenge_id as string); reply(true, ''); open.resolve(body.reason as string); return; }
    if (!accepts(open.ceremony, body.credential_id as number[])) { reply(false, 'The key that answered is not one this challenge allows'); return; }
    if ((body.prf_output as number[]).length !== 32) { reply(false, 'A PRF output is 32 bytes'); return; }
    this.pending.delete(body.challenge_id as string);
    reply(true, '');
    open.resolve({ credentialId: body.credential_id as number[], prf: body.prf_output as number[] });
  }

  private register(body: Req): void {
    const refused: string | null = this.admission.check(body.admission_token);
    if (refused) { this.emit('RegisterFailure', { request_id: body.request_id, message: 'A human check is required', reason_code: refused, ...this.admission.published(refused) }); return; }
    // One account per username here, as the agent: another server's is refused, typed, not overwritten.
    const held: FakeAccount | undefined = this.accounts.find((a) => a.username === body.username && a.server !== body.server_addr);
    if (held) { this.emit('RegisterFailure', { request_id: body.request_id, message: 'held', reason_code: 'username_held_for_another_server', held_for_server: held.server }); return; }
    const account: FakeAccount = this.account(body.username as string, 'Password', 100n + BigInt(this.accounts.length));
    account.server = body.server_addr as string;
    account.password = this.text(body.proposed_password) ?? '';
    this.emit('RegisterSuccess', { cid: account.cid, request_id: body.request_id, recovery_phrase: [...account.phrase] });
    // connect_after_register has no token left: the Register spent it (agent #112, Register.admission_token).
    if (this.admission.required) { this.emit('ConnectFailure', { cid: 0n, request_id: body.request_id, message: 'A human check is required', reason_code: 'admission_required', ...this.admission.published('admission_required') }); return; }
    this.emit('ConnectSuccess', { cid: account.cid, request_id: body.request_id });
  }

  private async connect(body: Req): Promise<void> {
    const requestId: string = body.request_id as string;
    const fail = (): void => this.emit('ConnectFailure', { cid: 0n, request_id: requestId, message: 'authentication failed' });
    const admission: string | null = this.admission.check(body.admission_token);
    if (admission) { this.emit('ConnectFailure', { cid: 0n, request_id: requestId, message: 'A human check is required', reason_code: admission, ...this.admission.published(admission) }); return; }
    const account: FakeAccount | undefined = this.accounts.find((a) => a.username === body.username);
    const refuse = (reason: string): void => this.emit('ConnectFailure', { cid: 0n, request_id: requestId, message: reason, reason_code: reason });
    if (!account) { refuse('no_such_account'); return; }
    if (account.server !== body.server_address) { refuse('account_on_another_server'); return; }
    const phrase: string | null = this.text(body.recovery_phrase);
    if (phrase !== null) {
      if (!isPhraseOf(account, phrase)) { fail(); return; }
      this.recoverySessions.add(account.cid);
      this.emit('ConnectSuccess', { cid: account.cid, request_id: requestId });
      return;
    }
    const password: string | null = this.text(body.password);
    if (account.policy !== 'KeyOnly' && password !== account.password) { fail(); return; }
    if (account.policy !== 'Password') {
      if (body.security_key !== true) { fail(); return; }
      const refused: string | null = await this.proveKey(account, requestId, 0n, 'SignIn');
      if (refused !== null) { this.emit('ConnectFailure', { cid: 0n, request_id: requestId, message: refused }); return; }
    }
    this.emit('ConnectSuccess', { cid: account.cid, request_id: requestId });
  }

  private async manage(body: Req): Promise<void> {
    const requestId: string = body.request_id as string;
    const cid: bigint = body.cid as bigint;
    const op: unknown = body.op;
    const stepUp: { password: number[] | null; security_key: boolean } = body.step_up as { password: number[] | null; security_key: boolean };
    const fail = (message: string, reason?: string): void => this.emit('SignInManagementFailure', { cid, request_id: requestId, message, ...(reason ? { reason } : {}) });
    const ok = (outcome: unknown): void => this.emit('SignInManagementSuccess', { cid, request_id: requestId, outcome });
    const account: FakeAccount | undefined = this.accounts.find((a) => a.cid === cid);
    if (!account) { fail(`Session ${cid} not found`); return; }
    const opName: string = typeof op === 'string' ? op : Object.keys(op as Req)[0];
    const recovery: boolean = this.recoverySessions.has(cid);
    if (recovery && !CONSOLE_OPS.has(opName)) { fail(RECOVERY_ONLY); return; }
    // Every request, listing included, needs a fresh proof (agent #112 eafca8da).
    if (!recovery) {
      const viaPassword: boolean = this.text(stepUp.password) === account.password && account.policy !== 'KeyOnly';
      if (!viaPassword || account.policy === 'PasswordAndKey') {
        if (!stepUp.security_key || account.keys.length === 0) { fail('A step-up proof is required'); return; }
        const refused: string | null = await this.proveKey(account, requestId, cid, 'StepUp');
        if (refused !== null) { fail(refused); return; }
      }
    }
    if (opName === 'ListCredentials') { ok({ Credentials: { policy: account.policy, credentials: listCredentials(account, true) } }); return; }
    const args: Req = typeof op === 'string' ? {} : (op as Req)[opName] as Req;
    if (opName === 'AddSecurityKey' && this.serverAt0122) {
      fail('the server predates enrolling a security key this client creates', 'server_cannot_enrol_security_keys');
    } else if (opName === 'AddSecurityKey') {
      // The SDK's Register ceremony: a random user handle, the account's name, and its keys excluded.
      const register: Ceremony = { Register: {
        user_id: Array.from(crypto.getRandomValues(new Uint8Array(32))), user_name: account.username,
        exclude_credential_ids: account.keys.map((k) => k.credentialId),
      } };
      const answer: { credentialId: number[]; prf: number[] } | string = await this.challenge(requestId, cid, 'Enrol', register);
      if (typeof answer === 'string') { fail(answer); return; }
      const id: number = this.nextFactor++;
      account.keys.push({ id, credentialId: answer.credentialId, label: args.label as string, prf: toBase64Url(Uint8Array.from(answer.prf)) });
      ok({ Added: { id } });
    } else if (opName === 'RenameCredential') {
      const key: FakeAccount['keys'][number] | undefined = account.keys.find((k) => k.id === args.id);
      if (!key) { fail('No such credential'); return; }
      key.label = args.label as string;
      ok('Renamed');
    } else if (opName === 'RemoveCredential') {
      if (account.policy !== 'Password' && account.keys.length === 1 && account.keys[0].id === args.id) {
        fail('Removing that key would leave no way to satisfy the sign-in policy');
        return;
      }
      account.keys = account.keys.filter((k) => k.id !== args.id);
      ok('Removed');
    } else if (opName === 'SetSignInPolicy') {
      const policy: SignInPolicy = args.policy as SignInPolicy;
      if (policy !== 'Password' && account.keys.length === 0) { fail('That policy needs a security key enrolled first'); return; }
      account.policy = policy;
      ok('PolicySet');
    } else if (opName === 'SetPassword') {
      account.password = this.text(args.new_password) ?? '';
      ok('PasswordSet');
    } else if (opName === 'RegenerateRecoveryPhrase') {
      account.phrase = fakePhrase(1000 + this.nextPhrase++);
      ok({ RecoveryPhrase: [...account.phrase] });
    }
  }
}
