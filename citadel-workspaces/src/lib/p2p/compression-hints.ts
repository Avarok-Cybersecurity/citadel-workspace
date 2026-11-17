/**
 * Which compression hint a reliable P2P payload is sent with.
 *
 * The hint tells the WASM client what the bytes are, and the ILM policy table
 * picks a codec from it: "json", "text" and "yjs-update" are compressed;
 * "cbor-command" and "opaque" go as they are. It is chosen here, from the
 * command being sent, never by inspecting encoded bytes afterwards.
 *
 * Both tables are total over their enums, so a new command or layer type does
 * not compile until someone decides how it is sent.
 */
import type { CompressionHint } from 'citadel-workspace-client-ts';
import { P2PCommandType, isMessagingLayerPayload, type P2PCommand } from '@/types/p2p-commands';
import { MessagingLayerType } from '@/types/messaging-layer';

const HINT_BY_LAYER: Record<MessagingLayerType, CompressionHint> = {
  [MessagingLayerType.Message]: 'cbor-command',
  [MessagingLayerType.Typing]: 'cbor-command',
  [MessagingLayerType.Away]: 'cbor-command',
  [MessagingLayerType.Online]: 'cbor-command',
  [MessagingLayerType.Offline]: 'cbor-command',
  [MessagingLayerType.CustomState]: 'cbor-command',
  [MessagingLayerType.CheckState]: 'cbor-command',
  [MessagingLayerType.CheckStateResponse]: 'cbor-command',
  [MessagingLayerType.FileTransferRequest]: 'cbor-command',
  [MessagingLayerType.FileTransferResponse]: 'cbor-command',
  [MessagingLayerType.FileTransferProgress]: 'cbor-command',
  [MessagingLayerType.FileTransferComplete]: 'cbor-command',
  [MessagingLayerType.FileTransferCancel]: 'cbor-command',
  // File bytes: already as dense as they will get, or not worth the attempt.
  [MessagingLayerType.FileTransferChunk]: 'opaque',
  // Paths, metadata and whole-tree snapshots: repetitive, structured, and
  // large enough to be worth compressing.
  [MessagingLayerType.RevfsOperation]: 'json',
  [MessagingLayerType.MessageEdit]: 'cbor-command',
  [MessagingLayerType.MessageDelete]: 'cbor-command',
  [MessagingLayerType.MessageReaction]: 'cbor-command',
  [MessagingLayerType.ScreenshotNotice]: 'cbor-command',
};

const HINT_BY_COMMAND: Record<Exclude<P2PCommandType, P2PCommandType.MessagingLayerCommand>, CompressionHint> = {
  [P2PCommandType.MessageAck]: 'cbor-command',
  [P2PCommandType.FileTransferRequest]: 'cbor-command',
  [P2PCommandType.FileTransferChunk]: 'opaque',
  [P2PCommandType.FileTransferComplete]: 'cbor-command',
  [P2PCommandType.YjsP2PSync]: 'yjs-update',
  [P2PCommandType.CallSignal]: 'cbor-command',
  // CRDT updates over text, as compressible as Yjs's.
  [P2PCommandType.CdocChatSync]: 'yjs-update',
};

/** The hint for a command, or undefined (no compression) for one this table does not know. */
export function compressionHintFor(command: P2PCommand): CompressionHint | undefined {
  if (command.type === P2PCommandType.MessagingLayerCommand) {
    return isMessagingLayerPayload(command.payload) ? HINT_BY_LAYER[command.payload.layer.type] : undefined;
  }
  return HINT_BY_COMMAND[command.type];
}

const KNOWN_HINTS: Record<CompressionHint, true> = {
  opaque: true,
  text: true,
  json: true,
  'yjs-update': true,
  'cbor-command': true,
};

/** For values that crossed a tab boundary: the WASM client rejects any other string. */
export function isCompressionHint(value: unknown): value is CompressionHint {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KNOWN_HINTS, value);
}
