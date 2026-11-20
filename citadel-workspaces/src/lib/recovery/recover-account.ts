/**
 * One `RecoverAccount`: the agent recovers the account with its phrase (on a device that holds no
 * bundle for it, revoking every other device), then signs in with the phrase to the recovery
 * console. Business logic only; the agent is reached through `AgentPort` (recovery-ports.ts).
 *
 * The answers, all under the request's id: `RecoverAccountSuccess` first when the account was
 * recovered here (other devices signed out), then the phrase sign-in's own `ConnectSuccess`,
 * `ConnectFailure` or `SessionAlreadyActive`; or `RecoverAccountFailure` alone.
 *
 * `SessionAlreadyActive` means this device already holds a full session for the account (another
 * window signed in): the agent will not open a recovery session beside it, so it is a refusal
 * with its own reason, not a wait for an answer that never comes.
 */
import { stringToBytes } from '@/lib/utils/encoding-utils';
import type { SessionSecuritySettings } from '@/lib/security-utils';
import type { AgentRequestBody } from '@/types/agent-request';
import type { AgentPort } from './recovery-ports';

/** The recovery and the sign-in after it: a server round trip each, and the recovery's key exchange. */
export const RECOVER_TIMEOUT_MS: 60000 = 60000;

export interface RecoverRequest {
  username: string;
  serverAddress: string;
  /** The 24 words, as `readCells` joined them. */
  phrase: string;
  deviceLabel: string;
  admissionToken: string | null;
  securitySettings: SessionSecuritySettings;
}

export interface RecoveryConsoleSession {
  cid: bigint;
  /** True when this device recovered the account, so every other device was signed out. */
  devicesSignedOut: boolean;
}

/** The agent refused: its own words, and the reason the UI can act on (a human check), if any. */
export class RecoveryRefusal extends Error {
  readonly reason: string | null;
  constructor(message: string, reason: string | null) {
    super(message);
    this.name = 'RecoveryRefusal';
    this.reason = reason;
  }
}

/** Said when this device is already signed in to the account in full. */
export const ALREADY_SIGNED_IN: string =
  'This account is already signed in on this device. Open it from your accounts, or sign it out here before recovering it.';

type Fields = Record<string, unknown>;

/** The variant `name` of `message` (bare, or wrapped in `Response`) when it answers `requestId`. */
function answer(message: unknown, name: string, requestId: string): Fields | null {
  if (!message || typeof message !== 'object') return null;
  const outer: Fields = message as Fields;
  const inner: Fields = outer.Response && typeof outer.Response === 'object' ? (outer.Response as Fields) : outer;
  const value: unknown = inner[name];
  if (!value || typeof value !== 'object') return null;
  return (value as Fields).request_id === requestId ? (value as Fields) : null;
}

const refusalOf = (fields: Fields, fallback: string): RecoveryRefusal =>
  new RecoveryRefusal(typeof fields.message === 'string' && fields.message !== '' ? fields.message : fallback,
    typeof fields.reason_code === 'string' ? fields.reason_code : null);

export function recoverAccount(port: AgentPort, request: RecoverRequest, requestId: string, timeoutMs: number): Promise<RecoveryConsoleSession> {
  return new Promise<RecoveryConsoleSession>((resolve, reject) => {
    let devicesSignedOut: boolean = false;
    const settle = (finish: () => void): void => { clearTimeout(timer); stop(); finish(); };
    const stop: () => void = port.listen((message: unknown): void => {
      if (answer(message, 'RecoverAccountSuccess', requestId)) { devicesSignedOut = true; return; }
      const refused: Fields | null = answer(message, 'RecoverAccountFailure', requestId);
      if (refused) { settle((): void => reject(refusalOf(refused, 'The account could not be recovered.'))); return; }
      const failed: Fields | null = answer(message, 'ConnectFailure', requestId);
      if (failed) { settle((): void => reject(refusalOf(failed, 'Signing in with the recovery phrase failed.'))); return; }
      if (answer(message, 'SessionAlreadyActive', requestId)) {
        settle((): void => reject(new RecoveryRefusal(ALREADY_SIGNED_IN, 'SessionAlreadyActive')));
        return;
      }
      const signedIn: Fields | null = answer(message, 'ConnectSuccess', requestId);
      if (signedIn && typeof signedIn.cid === 'bigint') {
        const cid: bigint = signedIn.cid;
        settle((): void => resolve({ cid, devicesSignedOut }));
      }
    });
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      stop();
      reject(new RecoveryRefusal('The Citadel agent did not answer in time. Check your connection and try again.', null));
    }, timeoutMs);
    const s: SessionSecuritySettings = request.securitySettings;
    const body: AgentRequestBody<'RecoverAccount'> = {
        request_id: requestId,
        server_addr: request.serverAddress.trim(),
        username: request.username.trim(),
        phrase: stringToBytes(request.phrase),
        device_label: request.deviceLabel.trim(),
        admission_token: request.admissionToken,
        session_security_settings: {
          security_level: s.security_level, secrecy_mode: s.secrecy_mode,
          header_obfuscator_settings: s.header_obfuscator_settings, crypto_params: s.crypto_params,
        },
        server_password: null,
    };
    port.send({ RecoverAccount: body }).catch((error: unknown): void => settle((): void => reject(error instanceof Error ? error : new Error(String(error)))));
  });
}
