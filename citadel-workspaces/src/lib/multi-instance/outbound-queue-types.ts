/**
 * Outbound Queue Types
 *
 * Type definitions and type guards for the outbound message queue.
 */

export interface QueuedMessage {
  requestId: string;
  payload: unknown;
  instanceId: string;
  timestamp: number;
  retryCount: number;
  timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * Known proxy response data shapes.
 * When adding new proxy operations that return data, add their shape here.
 */
export type ProxyResponseData =
  | { wasOpened: boolean }         // ensureMessengerOpen response
  | { agentIlm: boolean; supervisesP2p: boolean; stagesUploads: boolean; nativePicker?: boolean; takesConsole: boolean }  // what the leader's agent said it hosts, supervises, stages and takes
  | { success: boolean }           // generic operation result
  | Record<string, unknown>;       // fallback for other operations

export interface AckResult {
  status: 'processed' | 'error';
  error?: string;
  data?: ProxyResponseData;
}

/**
 * Type guard for ensureMessengerOpen response
 */
export function isEnsureMessengerOpenResponse(data: unknown): data is { wasOpened: boolean } {
  return (
    data !== null &&
    typeof data === 'object' &&
    'wasOpened' in data &&
    typeof (data as { wasOpened: unknown }).wasOpened === 'boolean'
  );
}
