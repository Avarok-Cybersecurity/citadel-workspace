/**
 * MessagingLayer Protocol Types
 *
 * This module defines the highest-level protocol layer for P2P messaging.
 * MessagingLayer is serialized and sent as the contents of WorkspaceProtocol::Message,
 * which itself is inscribed within InternalServiceRequest::Message for P2P transport.
 *
 * Protocol nesting:
 * InternalServiceRequest::Message {
 *   peer_cid: target,
 *   message: WorkspaceProtocol::Message {
 *     contents: MessagingLayer (serialized)
 *   }
 * }
 */

/**
 * Discriminant enum for MessagingLayer variants
 */
export enum MessagingLayerType {
  Message = 'Message',
  Typing = 'Typing',
  Away = 'Away',
  Online = 'Online',
  Offline = 'Offline',
  CustomState = 'CustomState',
  CheckState = 'CheckState',
  CheckStateResponse = 'CheckStateResponse',
  // File Transfer types
  FileTransferRequest = 'FileTransferRequest',
  FileTransferResponse = 'FileTransferResponse',
  FileTransferProgress = 'FileTransferProgress',
  FileTransferComplete = 'FileTransferComplete',
  FileTransferCancel = 'FileTransferCancel',
  // P2P file chunk streaming (for browser-compatible transfers)
  FileTransferChunk = 'FileTransferChunk',
  // RE-VFS tree operations (mkdir, rmdir, placeFile, etc.)
  RevfsOperation = 'RevfsOperation',

  // Message revision. Carried in-band like everything else here, so both
  // peers agree without any backend involvement.
  MessageEdit = 'MessageEdit',
  MessageDelete = 'MessageDelete',
  // A reaction added or retracted; see message-reaction-layer.ts.
  MessageReaction = 'MessageReaction',
  ScreenshotNotice = 'ScreenshotNotice' // see screenshot-notice-layer.ts
}

/**
 * Presence status types (subset of MessagingLayerType)
 */
export type PresenceStatus =
  | MessagingLayerType.Away
  | MessagingLayerType.Online
  | MessagingLayerType.Offline
  | MessagingLayerType.CustomState;

/**
 * MessagingLayer discriminated union type
 *
 * Represents all possible message types in the P2P messaging protocol:
 * - Message: Text message with contents and timestamp
 * - Typing: Indicates peer is currently typing
 * - Away: Peer is away/idle
 * - Online: Peer is online and active
 * - Offline: Peer is offline
 * - CustomState: Custom status with text and indicator color
 */
/**
 * File transfer state enumeration
 */
export type FileTransferState =
  | 'queued'       // Held until the recipient is online, then sent
  | 'preparing'    // Being staged on the sender's agent; not yet offered
  | 'pending'      // Waiting for recipient to accept/decline
  | 'transferring' // Active transfer in progress
  | 'complete'     // Transfer completed successfully
  | 'declined'     // Recipient declined the transfer
  | 'cancelled'    // Sender cancelled the transfer
  | 'expired'      // Transfer request expired (TTL exceeded)
  | 'error';       // Transfer failed with error

/**
 * File transfer request payload
 */
export interface FileTransferRequestData {
  transfer_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  thumbnail?: string;        // Base64 for images
  expiry_timestamp?: number; // When the request expires
  timestamp: number;
}

/**
 * File transfer response payload
 */
export interface FileTransferResponseData {
  transfer_id: string;
  accepted: boolean;
  decline_reason?: string;
  timestamp: number;
}

/**
 * File transfer progress payload
 */
export interface FileTransferProgressData {
  transfer_id: string;
  bytes_transferred: number;
  total_bytes: number;
  percentage: number;
  timestamp: number;
}

/**
 * File transfer complete payload
 */
export interface FileTransferCompleteData {
  transfer_id: string;
  success: boolean;
  error_message?: string;
  download_path?: string;    // Local path or URL where file was saved
  timestamp: number;
}

/**
 * File transfer cancel payload
 */
export interface FileTransferCancelData {
  transfer_id: string;
  reason?: string;
  /** It FAILED on the signalling side, not stopped by a person; older peers omit it. */
  failed?: boolean;
  timestamp: number;
}

/**
 * File transfer chunk payload for P2P streaming
 * Used for browser-compatible file transfers where files are sent in base64-encoded chunks
 */
export interface FileTransferChunkData {
  transfer_id: string;
  chunk_index: number;      // 0-based index of this chunk
  total_chunks: number;     // Total number of chunks for the file
  data: string;             // Base64-encoded chunk data
  checksum?: string;        // Optional SHA-256 hash of chunk data for integrity
  timestamp: number;
}

export type MessagingLayer =
  | { type: MessagingLayerType.Message; contents: string; timestamp: number }
  | { type: MessagingLayerType.Typing }
  | { type: MessagingLayerType.Away }
  | { type: MessagingLayerType.Online }
  | { type: MessagingLayerType.Offline }
  | { type: MessagingLayerType.CustomState; text: string; indicator_icon_color: string }
  | { type: MessagingLayerType.CheckState }
  | { type: MessagingLayerType.CheckStateResponse; ready: true }
  | { type: MessagingLayerType.MessageEdit; message_id: string; contents: string; edited_at: number }
  | { type: MessagingLayerType.MessageDelete; message_id: string; deleted_at: number }
  | import('./message-reaction-layer').MessageReactionLayer
  | import('./screenshot-notice-layer').ScreenshotNoticeLayer
  // File Transfer variants
  | { type: MessagingLayerType.FileTransferRequest } & FileTransferRequestData
  | { type: MessagingLayerType.FileTransferResponse } & FileTransferResponseData
  | { type: MessagingLayerType.FileTransferProgress } & FileTransferProgressData
  | { type: MessagingLayerType.FileTransferComplete } & FileTransferCompleteData
  | { type: MessagingLayerType.FileTransferCancel } & FileTransferCancelData
  // P2P chunk streaming variant (browser-compatible)
  | { type: MessagingLayerType.FileTransferChunk } & FileTransferChunkData
  // RE-VFS tree operations
  | { type: MessagingLayerType.RevfsOperation; operation: import('./revfs-types').RevfsOperation };

/**
 * Type guard: Check if MessagingLayer is a Message variant
 */
export function isMessage(layer: MessagingLayer): layer is { type: MessagingLayerType.Message; contents: string; timestamp: number } {
  return layer.type === MessagingLayerType.Message;
}

/**
 * Type guard: Check if MessagingLayer is a Typing variant
 */
export function isTyping(layer: MessagingLayer): layer is { type: MessagingLayerType.Typing } {
  return layer.type === MessagingLayerType.Typing;
}


/**
 * Type guard: Check if MessagingLayer is an Online variant
 */
export function isOnline(layer: MessagingLayer): layer is { type: MessagingLayerType.Online } {
  return layer.type === MessagingLayerType.Online;
}



/**
 * Type guard: Check if MessagingLayer is a presence-related variant
 */
export function isPresenceUpdate(layer: MessagingLayer): boolean {
  return layer.type === MessagingLayerType.Away ||
         layer.type === MessagingLayerType.Online ||
         layer.type === MessagingLayerType.Offline ||
         layer.type === MessagingLayerType.CustomState;
}



// ============================================================================
// File Transfer Type Guards
// ============================================================================

/**
 * Type guard: Check if MessagingLayer is a FileTransferRequest variant
 */
export function isFileTransferRequest(layer: MessagingLayer): layer is { type: MessagingLayerType.FileTransferRequest } & FileTransferRequestData {
  return layer.type === MessagingLayerType.FileTransferRequest;
}

/**
 * Type guard: Check if MessagingLayer is a FileTransferResponse variant
 */
export function isFileTransferResponse(layer: MessagingLayer): layer is { type: MessagingLayerType.FileTransferResponse } & FileTransferResponseData {
  return layer.type === MessagingLayerType.FileTransferResponse;
}



/**
 * Type guard: Check if MessagingLayer is a FileTransferCancel variant
 */
export function isFileTransferCancel(layer: MessagingLayer): layer is { type: MessagingLayerType.FileTransferCancel } & FileTransferCancelData {
  return layer.type === MessagingLayerType.FileTransferCancel;
}


/**
 * Type guard: Check if MessagingLayer is a RevfsOperation variant
 */
export function isRevfsOperation(layer: MessagingLayer): layer is { type: MessagingLayerType.RevfsOperation; operation: import('./revfs-types').RevfsOperation } {
  return layer.type === MessagingLayerType.RevfsOperation;
}


// ============================================================================
// Helper Constructors
// ============================================================================

/**
 * Create a Message variant
 */
export function createMessage(contents: string, timestamp?: number): MessagingLayer {
  return {
    type: MessagingLayerType.Message,
    contents,
    timestamp: timestamp ?? Date.now()
  };
}

/**
 * Create a MessageEdit variant.
 *
 * `message_id` names the message being revised, NOT this instruction — the
 * recipient looks it up in the conversation and replaces its contents.
 */
export function createMessageEdit(
  message_id: string,
  contents: string,
  edited_at?: number,
): MessagingLayer {
  return {
    type: MessagingLayerType.MessageEdit,
    message_id,
    contents,
    edited_at: edited_at ?? Date.now(),
  };
}

/**
 * Create a MessageDelete variant.
 *
 * Deletion removes the message from the conversation, matching how group chat
 * already behaves (`groupMessagingManager.handleMessageDeleted` filters it out)
 * rather than introducing a second convention with tombstones.
 */
export function createMessageDelete(message_id: string, deleted_at?: number): MessagingLayer {
  return {
    type: MessagingLayerType.MessageDelete,
    message_id,
    deleted_at: deleted_at ?? Date.now(),
  };
}

/**
 * Create a Typing variant
 */
export function createTyping(): MessagingLayer {
  return { type: MessagingLayerType.Typing };
}


/**
 * Create an Online variant
 */
export function createOnline(): MessagingLayer {
  return { type: MessagingLayerType.Online };
}



/**
 * Create a CheckState request - sent before messaging to verify P2P channel is active
 */
export function createCheckState(): MessagingLayer {
  return { type: MessagingLayerType.CheckState };
}

/**
 * Create a CheckStateResponse - always returns Ready
 * Even if we believe peer is ready, we respond Ready to ensure robustness
 */
export function createCheckStateResponse(): MessagingLayer {
  return { type: MessagingLayerType.CheckStateResponse, ready: true };
}

// ============================================================================
// File Transfer Helper Constructors
// ============================================================================
//
// Only the variants something actually SENDS have constructors: Request (the
// offer announcement), Response (accept/decline signal) and Cancel. The
// Progress / Complete / Chunk constructors that used to sit here had zero
// callers ever — they belonged to an abandoned message-plane transfer
// implementation; progress and completion are protocol notifications
// (FileTransferTickNotification), not chat messages. The TYPE variants stay
// declared because the wire union and its guards still name them.

/**
 * Create a FileTransferRequest variant
 * @param file_name - Name of the file being transferred
 * @param file_size - Size in bytes
 * @param file_type - MIME type of the file
 * @param options - Optional parameters (thumbnail, expiry)
 */
export function createFileTransferRequest(
  file_name: string,
  file_size: number,
  file_type: string,
  options?: {
    transfer_id?: string;
    thumbnail?: string;
    expiry_timestamp?: number;
  }
): MessagingLayer {
  return {
    type: MessagingLayerType.FileTransferRequest,
    transfer_id: options?.transfer_id ?? crypto.randomUUID(),
    file_name,
    file_size,
    file_type,
    thumbnail: options?.thumbnail,
    expiry_timestamp: options?.expiry_timestamp,
    timestamp: Date.now()
  };
}

/**
 * Create a FileTransferResponse variant
 * @param transfer_id - ID of the transfer being responded to
 * @param accepted - Whether the transfer was accepted
 * @param decline_reason - Optional reason for declining
 */
export function createFileTransferResponse(
  transfer_id: string,
  accepted: boolean,
  decline_reason?: string
): MessagingLayer {
  return {
    type: MessagingLayerType.FileTransferResponse,
    transfer_id,
    accepted,
    decline_reason,
    timestamp: Date.now()
  };
}

/**
 * Create a FileTransferCancel variant
 * @param transfer_id - ID of the transfer to cancel
 * @param reason - Optional reason for cancellation
 * @param failed - Whether it failed here, as opposed to being cancelled
 */
export function createFileTransferCancel(transfer_id: string, reason: string | undefined, failed: boolean): MessagingLayer {
  return {
    type: MessagingLayerType.FileTransferCancel,
    transfer_id, reason, failed,
    timestamp: Date.now()
  };
}


// ============================================================================
// Serialization Helpers
// ============================================================================



// ============================================================================
// Typing Indicator Constants
// ============================================================================

/** How often to poll for typing changes (ms) */
export const TYPING_POLL_INTERVAL_MS: number = 1000;

/** How long to display typing indicator after receiving (ms) */
export const TYPING_DISPLAY_DURATION_MS: number = 2000;

// ============================================================================
// File Transfer Constants
// ============================================================================

/** Default TTL for file transfer requests (7 days in ms) */
export const FILE_TRANSFER_REQUEST_TTL_MS: number = 7 * 24 * 60 * 60 * 1000;

/** How often to check for expired file transfers (6 hours in ms) */
export const FILE_TRANSFER_EXPIRY_CHECK_INTERVAL_MS: number = 6 * 60 * 60 * 1000;

/** Maximum number of auto-resend attempts for file transfer requests */
export const FILE_TRANSFER_MAX_RESEND_ATTEMPTS: number = 3;

/** Default max file size for transfers (100 MB) */
export const FILE_TRANSFER_DEFAULT_MAX_SIZE_BYTES: number = 100 * 1024 * 1024;

/** Default RE-VFS storage quota per peer (100 MB) */
export const REVFS_DEFAULT_QUOTA_BYTES: number = 100 * 1024 * 1024;
