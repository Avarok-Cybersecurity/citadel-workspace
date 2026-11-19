/**
 * What a peer connection's reported path is called on screen. One copy of each
 * string, read by the peer row, the chat header and their tests.
 */
import type { P2pPathReport } from 'citadel-workspace-client-ts';

export const CONNECTION_PATH_COPY: Readonly<Record<P2pPathReport, string>> = {
  direct: 'Direct',
  turn: 'Relayed via Cloudflare TURN',
  server_relay: 'Via workspace server',
};

export function connectionPathLabel(path: P2pPathReport | null): string | null {
  return path === null ? null : CONNECTION_PATH_COPY[path];
}
