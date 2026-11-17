/**
 * YJS Sync Message Types for P2P
 *
 * Types for YJS document synchronization protocol over P2P channels.
 */

// ============================================
// YJS SYNC MESSAGE TYPES
// ============================================

export type YjsSyncSubType =
  | 'sync_step1'
  | 'sync_step2'
  | 'update'
  | 'ack'
  | 'hash_check'
  | 'full_state'
  | 'request_full';

export interface YjsSyncMessage {
  type: 'yjs_sync';
  sub_type: YjsSyncSubType;
  document_id: string;
  data: Uint8Array | number[];
  doc_hash?: string;
  revision?: number;
  message_id: string;
  requires_ack?: boolean;
  is_creator?: boolean;
}

export interface YjsAwarenessMessage {
  type: 'yjs_awareness';
  document_id: string;
  awareness: Uint8Array | number[];
}

export interface YjsAckMessage {
  type: 'yjs_ack';
  document_id: string;
  message_id: string;
  local_hash: string;
  revision: number;
}

export interface YjsDivergenceMessage {
  type: 'yjs_divergence';
  document_id: string;
  local_hash: string;
  remote_hash: string;
  diverged_chunks?: number[];
  action: 'request_chunks' | 'full_resync';
}

export type YjsP2PMessage = YjsSyncMessage | YjsAwarenessMessage | YjsAckMessage | YjsDivergenceMessage;

// Type guards

export function isYjsSyncMessage(msg: unknown): msg is YjsSyncMessage {
  return typeof msg === 'object' && msg !== null && 'type' in msg && (msg as YjsSyncMessage).type === 'yjs_sync' && 'sub_type' in msg && 'document_id' in msg;
}

export function isYjsAwarenessMessage(msg: unknown): msg is YjsAwarenessMessage {
  return typeof msg === 'object' && msg !== null && 'type' in msg && (msg as YjsAwarenessMessage).type === 'yjs_awareness' && 'awareness' in msg;
}

export function isYjsAckMessage(msg: unknown): msg is YjsAckMessage {
  return typeof msg === 'object' && msg !== null && 'type' in msg && (msg as YjsAckMessage).type === 'yjs_ack' && 'message_id' in msg && 'local_hash' in msg;
}

export function isYjsDivergenceMessage(msg: unknown): msg is YjsDivergenceMessage {
  return typeof msg === 'object' && msg !== null && 'type' in msg && (msg as YjsDivergenceMessage).type === 'yjs_divergence' && 'action' in msg;
}

export function isYjsP2PMessage(msg: unknown): msg is YjsP2PMessage {
  return isYjsSyncMessage(msg) || isYjsAwarenessMessage(msg) ||
         isYjsAckMessage(msg) || isYjsDivergenceMessage(msg);
}
