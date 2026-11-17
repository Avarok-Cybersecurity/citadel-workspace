/**
 * Which agent responses this service reacts to.
 *
 * Four variants, and the set is the point: `ConnectSuccess` alone used to be
 * handled, so a scheduled reconnect that came back `ConnectFailure` — or
 * `SessionAlreadyActive`, which was not listened for at all — left its entry
 * in `reconnectAttempts` for ever and the poll skipped that account until
 * logout.
 *
 * Split out of `service.ts` when it passed the 250-line cap. Keeping the four
 * together makes the omission visible: a reader can see at a glance which
 * outcomes of a connect are accounted for.
 */
import { getVariant } from '@/lib/ws-message-boundary';
import type { WebSocketMessage } from '@/types/ws-message-types';

export interface ResponseHandlers {
  onConnectSuccess: (cid: bigint | undefined) => Promise<void>;
  onConnectFailure: (failure: { message?: string }) => void;
  onSessionAlreadyActive: () => void;
  onDisconnect: (notification: { cid?: bigint }) => void;
}

export async function dispatchWebSocketResponse(
  message: WebSocketMessage,
  handlers: ResponseHandlers,
): Promise<void> {
  const connectSuccess: Record<string, unknown> | undefined = getVariant(message, 'ConnectSuccess');
  if (connectSuccess) {
    await handlers.onConnectSuccess(connectSuccess.cid as bigint | undefined);
  }

  const connectFailure: Record<string, unknown> | undefined = getVariant(message, 'ConnectFailure');
  if (connectFailure) {
    handlers.onConnectFailure(connectFailure as { message?: string });
  }

  const alreadyActive: Record<string, unknown> | undefined = getVariant(message, 'SessionAlreadyActive');
  if (alreadyActive) {
    handlers.onSessionAlreadyActive();
  }

  const disconnect: Record<string, unknown> | undefined = getVariant(message, 'DisconnectNotification');
  if (disconnect) {
    handlers.onDisconnect(disconnect as { cid?: bigint });
  }
}
