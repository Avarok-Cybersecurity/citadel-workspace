/**
 * P2P Types Barrel
 *
 * Re-exports all P2P-related types from their split modules.
 */

// P2P Commands & Payloads
export type { MessagingLayer } from './p2p-commands';
export { MessagingLayerType } from './p2p-commands';
export {
  P2PCommandType,
} from './p2p-commands';
export type {
  P2PMessagingLayerPayload,
  P2PMessageAckPayload,
  P2PFileTransferRequestPayload,
  P2PFileTransferChunkPayload,
  P2PFileTransferCompletePayload,
  P2PAttachment,
  P2PCommand,
  P2PYjsSyncPayload,
} from './p2p-commands';
export {
  isMessagingLayerPayload,
  isMessageAckPayload,
  isFileTransferRequestPayload,
  isFileTransferChunkPayload,
  isFileTransferCompletePayload,
  isYjsSyncPayload,
  createMessagingLayerCommand,
  createMessageAckCommand,
  serializeP2PCommand,
  deserializeP2PCommand,
} from './p2p-commands';

// YJS Sync Types
export type {
  YjsSyncSubType,
  YjsSyncMessage,
  YjsAwarenessMessage,
  YjsAckMessage,
  YjsDivergenceMessage,
  YjsP2PMessage,
} from './yjs-types';
export {
  isYjsSyncMessage,
  isYjsAwarenessMessage,
  isYjsAckMessage,
  isYjsDivergenceMessage,
  isYjsP2PMessage,
} from './yjs-types';

// Merkle Tree Types
export type {
  SerializedChunk,
  MerkleProof,
  YjsMerkleProof,
  RevisionEntry,
} from './merkle-types';
