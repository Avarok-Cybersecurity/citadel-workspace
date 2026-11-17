/**
 * File Transfer I/O Router Interface
 *
 * Abstract interface for file transfer I/O operations.
 * Follows SBIO principle - only performs I/O, no business logic.
 *
 * Implementation:
 * - RealProtocolIORouter: Uses InternalServiceRequest commands (SendFile, etc.)
 */

import type {
  SendFileParams,
  SendFileResult,
  CancelTransferParams,
  RespondTransferParams,
  DownloadFileParams,
  TransferRequestEvent,
  TransferProgressEvent,
  TransferCompleteEvent,
  TransferStatusEvent,
} from './io-router-types';
import type { FileTransfer } from './types';

/**
 * Abstract interface for file transfer I/O operations.
 *
 * The RealProtocolIORouter implementation uses this interface,
 * allowing the FileTransferService to work with the I/O layer without changing business logic.
 */
export interface IFileTransferIORouter {
  /**
   * Declare that an outgoing SendFile stream is NOT a chat transfer.
   *
   * The internal service stamps a revfs push's ticks with the browser's own
   * SendFile request_id, and the tick correlator falls back to the oldest live
   * transfer to the same peer when it cannot match one -- so an unregistered
   * push can complete or fail an unrelated pending chat transfer. Every caller
   * that issues a SendFile for something other than a chat transfer must say
   * so here.
   *
   * On the interface rather than only on the protocol router so a caller
   * outside this module can reach it without narrowing the type, and so a
   * future router cannot quietly omit it.
   */
  markForeignOutgoingStream(requestId: string): void;

  // ============================================================================
  // Send Operations
  // ============================================================================

  /**
   * Send a file to a recipient.
   *
   * Sends a SendFile InternalServiceRequest via the real protocol.
   *
   * @param params - Send file parameters
   * @returns Protocol-level transfer ID and client transfer ID
   */
  sendFile(params: SendFileParams): Promise<SendFileResult>;

  /**
   * Cancel an in-progress transfer.
   *
   * Cleans up local state. The real protocol doesn't have an explicit cancel command;
   * cancellation happens implicitly when either side disconnects.
   *
   * @param params - Cancel parameters
   */
  cancelTransfer(params: CancelTransferParams): Promise<void>;


  // ============================================================================
  // Receive Operations
  // ============================================================================

  /**
   * Respond to an incoming transfer request (accept or decline).
   *
   * Sends a RespondFileTransfer InternalServiceRequest.
   *
   * @param params - Response parameters
   * @returns the request id an accepted stream's ticks carry
   */
  respondToTransfer(params: RespondTransferParams): Promise<string>;

  /**
   * Download a file from server/peer virtual storage.
   *
   * Sends a DownloadFile InternalServiceRequest.
   *
   * @param params - Download parameters
   */
  downloadFile(params: DownloadFileParams): Promise<void>;

  // ============================================================================
  // Subscriptions
  // ============================================================================

  /**
   * Subscribe to incoming transfer requests.
   *
   * @param callback - Called when a new transfer request is received
   * @returns Unsubscribe function
   */
  onTransferRequest(callback: (event: TransferRequestEvent) => void): () => void;

  /**
   * Subscribe to transfer progress updates.
   *
   * Progress comes from FileTransferTickNotification events.
   *
   * @param callback - Called on progress updates
   * @returns Unsubscribe function
   */
  onProgress(callback: (event: TransferProgressEvent) => void): () => void;

  /**
   * Subscribe to transfer completion events.
   *
   * @param callback - Called when a transfer completes (success or failure)
   * @returns Unsubscribe function
   */
  onComplete(callback: (event: TransferCompleteEvent) => void): () => void;

  /**
   * Subscribe to transfer status changes (accept/decline confirmations).
   *
   * @param callback - Called when transfer status changes
   * @returns Unsubscribe function
   */
  onStatusChange(callback: (event: TransferStatusEvent) => void): () => void;

  // ============================================================================
  // File Utilities
  // ============================================================================

  /**
   * Generate thumbnail for an image file.
   *
   * @param file - Image file
   * @returns Data URL of thumbnail
   */
  generateThumbnail(file: File): Promise<string>;

  // ============================================================================
  // Context
  // ============================================================================

  /**
   * Get the current session CID.
   *
   * @returns Current CID or null if no session
   */
  getCurrentCid(): Promise<bigint | null>;

  /**
   * Notify state change to external systems (P2P messenger manager, etc.).
   *
   * @param transfer - Updated transfer object
   */
  notifyStateChange(transfer: FileTransfer): void;

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Clean up resources (unsubscribe from events, etc.).
   */
  dispose(): void;
}
