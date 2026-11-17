/** Reading the connection path an agent reports on PeerConnectSuccess and PeerPathChangedNotification. */
import type { PeerConnectPath, PeerPathReport } from '@/types/ice-servers';

const PATHS: readonly PeerConnectPath[] = ['direct', 'turn', 'server_relay'];

/**
 * The `{ path, upgrading }` of a report, or null from an agent that sends no path.
 * An agent that reports a path but not `upgrading` predates background upgrades:
 * its path does not change, so it reads as not upgrading.
 */
export function parsePeerPathReport(value: unknown): PeerPathReport | null {
  if (typeof value !== 'object' || value === null) return null;
  const v: { path?: unknown; upgrading?: unknown } = value as { path?: unknown; upgrading?: unknown };
  const path: PeerConnectPath | undefined = PATHS.find((p: PeerConnectPath): boolean => p === v.path);
  return path === undefined ? null : { path, upgrading: v.upgrading === true };
}
