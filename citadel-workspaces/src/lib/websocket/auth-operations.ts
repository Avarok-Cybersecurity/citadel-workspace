/**
 * Authentication Operations
 *
 * Handles connect and register operations via the internal service.
 * Extracted from websocket-service.ts to reduce file size.
 */

import { debugLog } from '../debug-config';
import {
  type SessionSecuritySettings,
  getDefaultSecuritySettings
} from '../security-utils';
import { resolveServerAddress } from '../address-resolver';
import { instanceManager } from '../multi-instance';
import { stringToBytes } from '../utils/encoding-utils';
import type { PreSharedKey } from '@avarok/citadel-protocol-types';
import type { HeaderObfuscatorSettings } from '@/lib/security-utils';
import { connectFactorFields } from '../sign-in/factors';
import type { ConnectFactorFields, SignInFactors } from '../sign-in/types';

export interface AuthConfig {
  init: () => Promise<void>;
  sendRequest: (request: unknown, requestId?: string) => Promise<void>;
  claimSession: (cid: bigint, onlyIfOrphaned: boolean) => Promise<unknown>;
  disconnect: (cid: bigint) => Promise<void>;
}

export class AuthOperations {
  private readonly config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  async connect(
    requestId: string,
    username: string,
    /** The server the account is on; the agent refuses a Connect whose account is on another. */
    serverAddress: string,
    factors: SignInFactors,
    sessionSecuritySettings?: SessionSecuritySettings
  ): Promise<void> {
    if (serverAddress.trim() === '') throw new Error(`No server is recorded for ${username}; sign in again from the sign-in form`);
    await this.config.init();

    debugLog('AuthOperations', `[Connect] Connecting user: ${username}`);

    // No session lookup before authenticating. Connect goes to the server with
    // the credentials, always.
    //
    // This used to match the agent's active sessions on USERNAME alone and, if
    // the local store had no matching CID, claim the session and RETURN --
    // without ever sending Connect. The password the user typed was never used
    // by anything: not by this function, not by the agent (whose own reuse
    // branch did not check it either), not by the server, which was never
    // asked. It is the same defect removed from `useLoginHandler` one layer up,
    // whose comment says the decision belongs where it can actually be made --
    // and this is what stopped it being made at all.
    //
    // It also broke the login it silently completed: the claim carries its own
    // request id, so the handler waiting for a ConnectSuccess / Connect-
    // Failure / SessionAlreadyActive on ITS id waited out the full 30 seconds
    // and reported "Connection timeout, check your network".
    //
    // The legitimate case is unaffected and better handled: the server answers
    // SessionAlreadyActive (having verified the password), and the caller
    // claims from there. Disconnecting a live session first, which the other
    // branch did, was worse still -- tearing down a working session on the
    // strength of an unauthenticated request naming its username.

    // Proceed with Connect request
    debugLog('AuthOperations', `[Connect] Proceeding with new connection for ${username}`);

    // Use provided settings or defaults (snake_case from SessionSecuritySettings)
    const settings: SessionSecuritySettings = sessionSecuritySettings ?? getDefaultSecuritySettings();

    const connectOptions: ConnectFactorFields & { request_id: string; username: string; server_address: string; connect_mode: { Standard: { force_login: boolean; }; }; udp_mode: string; keep_alive_timeout: null; session_security_settings: { security_level: string; secrecy_mode: string; header_obfuscator_settings: HeaderObfuscatorSettings; crypto_params: { encryption_algorithm: string; kem_algorithm: string; sig_algorithm: string; }; }; } = {
      request_id: requestId,
      username,
      server_address: serverAddress.trim(),
      // Which factors this window offers; the server's policy decides which it needs.
      ...connectFactorFields(factors),
      connect_mode: { Standard: { force_login: true } },
      udp_mode: "Disabled",
      keep_alive_timeout: null,
      session_security_settings: {
        security_level: settings.security_level,
        secrecy_mode: settings.secrecy_mode,
        header_obfuscator_settings: settings.header_obfuscator_settings,
        crypto_params: settings.crypto_params,
      },
    };

    const connectRequest: { Connect: ConnectFactorFields & { request_id: string; username: string; server_address: string; connect_mode: { Standard: { force_login: boolean; }; }; udp_mode: string; keep_alive_timeout: null; session_security_settings: { security_level: string; secrecy_mode: string; header_obfuscator_settings: HeaderObfuscatorSettings; crypto_params: { encryption_algorithm: string; kem_algorithm: string; sig_algorithm: string; }; }; }; } = { Connect: connectOptions };

    debugLog('AuthOperations', `[Connect] Sending Connect request with request_id: ${requestId}`);
    debugLog('AuthOperations', `[Connect] isLeader: ${instanceManager.isLeader}`);

    try {
      await this.config.sendRequest(connectRequest, requestId);
      debugLog('AuthOperations', `[Connect] Connect request sent successfully for ${username}`);
    } catch (sendError) {
      debugLog('AuthOperations', '[Connect] FAILED to send Connect request:', sendError);
      throw sendError;
    }
  }

  async register(
    requestId: string,
    username: string,
    password: string,
    fullName: string,
    serverAddr: string,
    /** A Turnstile token when the workspace asks for a human check; single-use. */
    admissionToken: string | null,
    serverPassword?: string,
    sessionSecuritySettings?: SessionSecuritySettings
  ): Promise<void> {
    await this.config.init();

    // Resolve hostname to IP if needed (DNS resolution)
    const resolvedAddr: string = await resolveServerAddress(serverAddr);
    debugLog('AuthOperations', `[Register] Resolved address: ${serverAddr} -> ${resolvedAddr}`);

    // Use provided settings or defaults (snake_case from SessionSecuritySettings)
    const settings: SessionSecuritySettings = sessionSecuritySettings ?? getDefaultSecuritySettings();

    const registerOptions: { request_id: string; server_addr: string; full_name: string; username: string; proposed_password: number[]; connect_after_register: boolean; session_security_settings: { security_level: string; secrecy_mode: string; header_obfuscator_settings: HeaderObfuscatorSettings; crypto_params: { encryption_algorithm: string; kem_algorithm: string; sig_algorithm: string; }; }; server_password: { passwords: number[][]; } | null; admission_token: string | null; } = {
      request_id: requestId,
      server_addr: resolvedAddr,
      full_name: fullName,
      username,
      proposed_password: stringToBytes(password),
      connect_after_register: true,
      session_security_settings: {
        security_level: settings.security_level,
        secrecy_mode: settings.secrecy_mode,
        header_obfuscator_settings: settings.header_obfuscator_settings,
        crypto_params: settings.crypto_params,
      },
      // Note: server_password is the Citadel protocol PreSharedKey for C2S
      // connection, NOT the workspace master password. The workspace master
      // password is validated at the workspace protocol layer (CreateWorkspace
      // / JoinWorkspace), not here.
      //
      // Wire-format pin: the Rust side expects `Option<PreSharedKey>`, where
      // `PreSharedKey = { passwords: Vec<Vec<u8>> }`. The TS counterpart from
      // `@avarok/citadel-protocol-types` is `{ passwords: Array<Array<number>> }`.
      // `satisfies PreSharedKey` validates the literal against the imported
      // type WITHOUT widening or narrowing — unlike `as PreSharedKey`, this
      // keeps the compiler's structural check active, so a future field
      // rename or new required member surfaces as a TS error here rather
      // than being silently sent to the server. The matching round-trip is
      // also pinned in `auth-operations-register.test.ts`.
      server_password: serverPassword
        ? ({ passwords: [stringToBytes(serverPassword)] } satisfies PreSharedKey)
        : null,
      admission_token: admissionToken,
    };

    // Redact secrets before logging: registerOptions carries the account
    // `proposed_password` and the server `server_password` (the Citadel
    // PreSharedKey) as byte arrays — never emit either to logs, even gated
    // debug ones (debug logging can be enabled in shared/prod environments).
    debugLog('AuthOperations', 'Sending register options to WASM client', {
      ...registerOptions,
      proposed_password: '<redacted>',
      server_password: registerOptions.server_password ? '<redacted>' : null,
    });

    const registerRequest: { Register: { request_id: string; server_addr: string; full_name: string; username: string; proposed_password: number[]; connect_after_register: boolean; session_security_settings: { security_level: string; secrecy_mode: string; header_obfuscator_settings: HeaderObfuscatorSettings; crypto_params: { encryption_algorithm: string; kem_algorithm: string; sig_algorithm: string; }; }; server_password: { passwords: number[][]; } | null; admission_token: string | null; }; } = { Register: registerOptions };

    debugLog('AuthOperations', `[Register] isLeader: ${instanceManager.isLeader}`);

    await this.config.sendRequest(registerRequest, requestId);
  }
}
