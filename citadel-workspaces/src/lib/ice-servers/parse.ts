/**
 * Reading the GetIceServers answer off the wire.
 *
 * Workspace responses arrive JSON-decoded, so `expires_at` is a `number` there
 * even though the Rust side declares `u64`; both are accepted and the result is
 * a `bigint`. Anything that does not have the declared shape is `null`, never a
 * partly-filled grant.
 *
 * Only the lazily-loaded relay lookup imports this; the reported path, which
 * the eager PeerConnect path reads, lives in path.ts so this stays off the
 * landing page's bundle. Logs are redacted by debug-formatter, which already
 * treats `credential` as a secret.
 */
import type { IceServer, IceServersAnswer } from '@/types/ice-servers';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function toIceServer(value: unknown): IceServer | null {
  if (!isRecord(value)) return null;
  const { urls, username, credential } = value;
  if (!Array.isArray(urls) || !urls.every((u: unknown): boolean => typeof u === 'string')) return null;
  if (!isStringOrNull(username) || !isStringOrNull(credential)) return null;
  return { urls: urls as string[], username, credential };
}

function toUnixSeconds(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

/** Narrow a `WorkspaceProtocolResponse` to an answer to `GetIceServers`, or null. */
export function parseIceServersAnswer(response: unknown): IceServersAnswer | null {
  if (!isRecord(response)) return null;

  if ('IceServers' in response) {
    const body: unknown = response.IceServers;
    if (!isRecord(body) || !Array.isArray(body.ice_servers)) return null;
    const servers: Array<IceServer | null> = body.ice_servers.map(toIceServer);
    const expiresAt: bigint | null = toUnixSeconds(body.expires_at);
    if (expiresAt === null || servers.some((s: IceServer | null): boolean => s === null)) return null;
    return { kind: 'granted', grant: { ice_servers: servers as IceServer[], expires_at: expiresAt } };
  }

  if ('IceServersUnavailable' in response) {
    const body: unknown = response.IceServersUnavailable;
    if (!isRecord(body) || typeof body.reason !== 'string') return null;
    return { kind: 'unavailable', reason: body.reason };
  }

  if ('Error' in response && typeof response.Error === 'string') {
    return { kind: 'refused', message: response.Error };
  }

  return null;
}
