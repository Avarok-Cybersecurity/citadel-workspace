/**
 * A member's relay (TURN) servers, per session, held in memory only.
 *
 * Credentials are short-lived and minted per member by the workspace server,
 * so they are fetched when a peer connection needs them and reused until 80%
 * of their lifetime has passed. A refusal — no relay configured, a Guest, an
 * old server, silence — is remembered for a minute and answered with `null`,
 * so a peer connect is never held up asking again and again for something the
 * server has just said it will not give.
 *
 * Never persisted and never logged: the grant lives in this Map and nowhere
 * else. Logs name the session and the reason, not the answer.
 */
import { debugLog, warnLog } from '@/lib/debug-config';
import type { IceServersAnswer, IceServersGrant } from '@/types/ice-servers';
import { parseIceServersAnswer } from './parse';

/** Sends `GetIceServers` on a session and resolves with the server's response. */
export interface IceServersPort {
  request(cid: bigint): Promise<unknown>;
}

/** Refetch once this fraction of a grant's lifetime has passed. */
export const REFRESH_AT_FRACTION: number = 0.8;
/** How long a refusal is believed before asking again. */
export const REFUSAL_CACHE_MS: number = 60_000;

interface CacheEntry {
  grant: IceServersGrant | null;
  validUntilMs: number;
}

export class IceServersCache {
  private readonly entries: Map<bigint, CacheEntry> = new Map<bigint, CacheEntry>();
  private readonly inFlight: Map<bigint, Promise<IceServersGrant | null>> = new Map<bigint, Promise<IceServersGrant | null>>();

  constructor(
    private readonly port: IceServersPort,
    private readonly nowMs: () => number,
  ) {}

  /** The session's current grant, or null when the server has none for it. */
  get(cid: bigint): Promise<IceServersGrant | null> {
    const cached: CacheEntry | undefined = this.entries.get(cid);
    if (cached && this.nowMs() < cached.validUntilMs) return Promise.resolve(cached.grant);

    const pending: Promise<IceServersGrant | null> | undefined = this.inFlight.get(cid);
    if (pending) return pending;

    const fetching: Promise<IceServersGrant | null> = this.fetch(cid).finally((): void => {
      this.inFlight.delete(cid);
    });
    this.inFlight.set(cid, fetching);
    return fetching;
  }

  /** Drop a session's grant, e.g. when it logs out. */
  forget(cid: bigint): void {
    this.entries.delete(cid);
  }

  private async fetch(cid: bigint): Promise<IceServersGrant | null> {
    const fetchedAtMs: number = this.nowMs();
    let answer: IceServersAnswer | null;
    try {
      answer = parseIceServersAnswer(await this.port.request(cid));
    } catch (error: unknown) {
      const reason: string = error instanceof Error ? error.message : String(error);
      return this.fail(cid, fetchedAtMs, `request failed: ${reason}`);
    }

    if (answer === null) return this.fail(cid, fetchedAtMs, 'unrecognised answer');
    if (answer.kind === 'unavailable') return this.refuse(cid, fetchedAtMs, answer.reason);
    if (answer.kind === 'refused') return this.refuse(cid, fetchedAtMs, answer.message);

    const lifetimeMs: number = Number(answer.grant.expires_at) * 1000 - fetchedAtMs;
    // An already-expired grant is handed on (the relay decides) but not kept.
    if (lifetimeMs > 0) {
      this.entries.set(cid, {
        grant: answer.grant,
        validUntilMs: fetchedAtMs + lifetimeMs * REFRESH_AT_FRACTION,
      });
    }
    debugLog('IceServers', 'relay servers received', {
      cid,
      servers: answer.grant.ice_servers.length,
      expiresAt: answer.grant.expires_at,
    });
    return answer.grant;
  }

  /**
   * A lookup that broke, as opposed to a tenant that said no: the connection goes ahead
   * without a relay, so it is reported where production can see it. Found live: every
   * lookup timed out and nothing said so, because this was a debug-only log.
   */
  private fail(cid: bigint, atMs: number, reason: string): null {
    warnLog('IceServers', 'relay lookup failed; connecting without a relay', { cid, reason });
    return this.refuse(cid, atMs, reason);
  }

  private refuse(cid: bigint, atMs: number, reason: string): null {
    debugLog('IceServers', 'no relay servers for session', { cid, reason });
    this.entries.set(cid, { grant: null, validUntilMs: atMs + REFUSAL_CACHE_MS });
    return null;
  }
}
