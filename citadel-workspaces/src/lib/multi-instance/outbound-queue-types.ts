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
  | { supervisesP2p: boolean; stagesUploads: boolean; nativePicker: boolean; takesConsole: boolean; servesApps: boolean; notesToSelf: boolean; noticesHeard: boolean }  // what the leader's agent said it supervises, stages, offers and takes
  | { success: boolean }           // generic operation result
  | Record<string, unknown>;       // fallback for other operations

export interface AckResult {
  status: 'processed' | 'error';
  error?: string;
  data?: ProxyResponseData;
}
