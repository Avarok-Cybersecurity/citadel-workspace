/**
 * Types and helpers for ConnectionRetryModal.
 */

export interface ConnectionRetryModalProps {
  isOpen: boolean;
  onClose: () => void;
  errorMessage?: string;
  onRetry?: () => Promise<void>;
  maxRetries?: number;
  maxBackoffSeconds?: number; // Maximum backoff time in seconds (default: number = 5 minutes)
}

/**
 * Calculate retry delay based on attempt number (exponential backoff).
 * Starts at 2s, then 4s, 8s, 16s, 32s, 64s, 128s, 256s (capped at maxBackoffSeconds)
 */
export function getRetryDelay(attempt: number, maxBackoffSeconds: number): number {
  const baseDelay: number = 2000; // Start with 2 seconds
  return Math.min(baseDelay * Math.pow(2, attempt - 1), maxBackoffSeconds * 1000);
}
