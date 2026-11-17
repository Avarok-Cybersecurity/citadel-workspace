/**
 * File Transfer I/O Router Types
 *
 * Type definitions for the abstract IFileTransferIORouter interface.
 * Used by the RealProtocolIORouter implementation.
 */


// ============================================================================
// FileSource Enum (matches Rust definition)
// ============================================================================

/**
 * FileSource enum for specifying file source in SendFile requests.
 * Matches the Rust FileSource enum in citadel-internal-service-types.
 *
 * IMPORTANT — `ByteContents` size cap:
 * The `data: number[]` payload materialises the entire file as a boxed-
 * number JavaScript array (~4-8 bytes per file byte in V8) and is then
 * CBOR-serialised onto the WebSocket frame. A 100 MB file therefore
 * needs roughly 500 MB of transient heap and reliably crashes the tab.
 * `executeSendFile` in `send-operations.ts` enforces a hard 2 MiB cap
 * BEFORE allocating the buffer; larger uploads must go through `Path`
 * (native picker) which streams from disk. Round-trip tests in
 * `__tests__/send-operations-byte-contents.test.ts` pin both the wire
 * shape and the size-guard ordering.
 */
export type FileSource =
  | { Path: string }
  | { PickFileRef: { pick_file_request_id: string } }
  | { ByteContents: { file_name: string; data: number[] } }
  /** A browser file staged on the agent in chunks (staged-upload/), complete. */
  | { StagedUpload: { upload_id: string } };

// ============================================================================
// Send Operation Types
// ============================================================================

export interface SendFileParams {
  /** Source file - File object for message-based, path/PickFileRef for real protocol */
  source: File | string;
  /** Sender's CID */
  cid: bigint;
  /** Recipient's CID (null for C2S server storage) */
  peerCid: bigint | null;
  /** Client-generated transfer ID for correlation */
  transferId: string;
  /** Optional chunk size override */
  chunkSize?: number;
  /** File metadata (required for message-based protocol) */
  metadata?: FileMetadata;
  /** PickFile request ID (for real protocol with PickFileRef) */
  pickFileRequestId?: string;
  /** The browser file is already staged on the agent under this upload id (staged-upload/). */
  stagedUploadId?: string;
}

export interface FileMetadata {
  fileName: string;
  fileSize: number;
  fileType: string;
  thumbnail?: string;
  expiresAt?: number;
}

export interface SendFileResult {
  /** Protocol-level identifier (object_id for real protocol, transfer_id for message-based) */
  protocolId: string;
  /** Client transfer ID echoed back */
  transferId: string;
  /**
   * The SendFile request's id. The agent can answer it a SECOND time, with a
   * SendFileRequestFailure, when the SDK refuses the object after accepting the
   * request; the router files it so that refusal still reaches the transfer.
   */
  requestId: string;
}

export interface CancelTransferParams {
  transferId: string;
  targetCid: bigint;
  reason?: string;
}

// ============================================================================
// Receive Operation Types
// ============================================================================

export interface RespondTransferParams {
  /** The protocol's object_id for this transfer. */
  protocolId: string;
  /**
   * Client transfer id, so an ACCEPT can pre-register the reception tick
   * stream: the internal service spawns that stream under the
   * RespondFileTransfer request UUID, and the ticks themselves are id-less.
   */
  transferId?: string;
  cid: bigint;
  peerCid: bigint;
  accept: boolean;
  downloadLocation?: string;
}

export interface DownloadFileParams {
  virtualDirectory: string;
  cid: bigint;
  peerCid: bigint | null;
  securityLevel?: string;
  deleteOnPull?: boolean;
}

// ============================================================================
// Event Types (for subscriptions)
// ============================================================================

export interface TransferRequestEvent {
  /** Recipient's CID (our CID) */
  cid: bigint;
  /** Sender's CID */
  peerCid: bigint;
  /** Protocol-level ID (object_id or transfer_id) */
  protocolId: string;
  /** File name (only in message-based) */
  fileName?: string;
  /** File size in bytes (only in message-based) */
  fileSize?: number;
  /** MIME type (only in message-based) */
  fileType?: string;
  /** Thumbnail data (only in message-based) */
  thumbnail?: string;
  /** Expiry timestamp (only in message-based) */
  expiresAt?: number;
}

export interface TransferProgressEvent {
  /**
   * Resolved client transfer id, when the tick stream could be joined exactly
   * (recipient streams; see tick-events.ts). Sender-side ticks carry no id on
   * the wire, so this is undefined there and the service resolves by
   * (cid, peerCid, direction) instead.
   */
  transferId?: string;
  /** Local session CID the notification was addressed to. */
  cid: bigint;
  /** The other side of the transfer. */
  peerCid: bigint;
  direction: 'outgoing' | 'incoming';
  /** Group counts, not bytes — the wire reports groups; percentage is exact. */
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  status?: TransferProgressStatus;
  /** Where the agent writes a reception, from its first tick; see tick-events.ts. */
  downloadPath?: string;
}

export type TransferProgressStatus =
  | 'pending'
  | 'uploading'
  | 'downloading'
  | 'transferring'
  | 'complete'
  | 'failed';

export interface TransferCompleteEvent {
  /** Resolved client transfer id when known — see TransferProgressEvent. */
  transferId?: string;
  cid: bigint;
  peerCid: bigint;
  /** 'unknown' for Fail ticks, which name neither a direction nor an id. */
  direction: 'outgoing' | 'incoming' | 'unknown';
  success: boolean;
  downloadPath?: string;
  errorMessage?: string;
}

export interface TransferStatusEvent {
  protocolId: string;
  /** Resolved from protocolId via the offer correlator, when joined. */
  transferId?: string;
  cid: bigint;
  success: boolean;
  accepted: boolean;
  message?: string;
}

// ============================================================================
// Router Configuration
// ============================================================================

export type IORouterType = 'real-protocol';

export interface IORouterConfig {
  type: IORouterType;
}
