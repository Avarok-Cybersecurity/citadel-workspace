/**
 * WebSocket Service - Types
 */

export interface WebSocketServiceConfig {
  websocketUrl?: string;
  messageHandler?: (message: unknown) => void;
  errorHandler?: (error: Error) => void;
}
