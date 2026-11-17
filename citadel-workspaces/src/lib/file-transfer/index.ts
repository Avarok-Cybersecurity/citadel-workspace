/**
 * File Transfer Module
 *
 * Re-exports for backward compatibility.
 */

// Types
export type {
  FileTransfer,
  FileTransferSettings,
  TransferProgressEvent,
  FileTransferIntent,
  IncomingFileTransferMessage,
  FilePickerResult,
} from './types';

// I/O Router Types
export type {
  SendFileParams,
  SendFileResult,
  CancelTransferParams,
  RespondTransferParams,
  DownloadFileParams,
  TransferRequestEvent,
  TransferProgressEvent as IOTransferProgressEvent,
  TransferCompleteEvent,
  TransferStatusEvent,
  FileSource,
  IORouterType,
  IORouterConfig,
} from './io-router-types';

// I/O Router Interface
export type { IFileTransferIORouter } from './io-router';

// Events
export { FILE_TRANSFER_EVENTS, type FileTransferEventType } from './events';

// State (for testing/advanced usage)
export { FileTransferState } from './state';

// IO (backward compatibility - use I/O Router implementations instead)
export { FileTransferIO } from './io';

// I/O Router Implementation
export { RealProtocolIORouter } from './real-protocol-io-router';

// I/O Router Factory
export {
  createIORouter,
  createIORouterFromConfig,
  getDefaultRouterType,
  isRealProtocolAvailable,
} from './io-router-factory';

// Service
export { FileTransferService, fileTransferService } from './service';
