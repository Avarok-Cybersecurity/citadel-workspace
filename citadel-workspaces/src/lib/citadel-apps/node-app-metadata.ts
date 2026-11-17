/**
 * Which Citadel App a document node opens in, kept in the node's `metadata` bytes.
 *
 * Node metadata follows the workspace metadata convention (lib/workspace-metadata): one JSON
 * object whose top-level keys belong to independent features, merged into and never assigned
 * over, and the server stores only a document of that shape (server_ops/node_metadata.rs). The
 * app id lives under its own key as a versioned envelope (types/workspace-metadata), so a
 * reader can tell "no app" from "an app this client cannot read".
 *
 * JSON, not CBOR: the server checks and merges the document as JSON, and the envelope holds
 * only short strings and a small integer, so nothing in it needs CBOR's BigInt support.
 */
import type { MetadataEnvelope } from '@/types/workspace-metadata';
import { metadataDocument, type MetadataSource } from '@/lib/workspace-metadata/metadata-document';
import { isCitadelAppId, type CitadelAppId } from './registry';

export const NODE_APP_METADATA_KEY: 'citadel_app' = 'citadel_app';
export const NODE_APP_METADATA_VERSION: 1 = 1;
const KIND: 'citadel-app' = 'citadel-app';

type NodeAppEnvelope = MetadataEnvelope<typeof KIND, { app: CitadelAppId }>;

/** The node names an app, but not in a form this client reads. */
export class NodeAppMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeAppMetadataError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `existing` with the app id set, every other key kept. An unreadable or absent document
 * contributes no keys, the same rule the server applies when it merges metadata.
 */
export function encodeNodeApp(existing: MetadataSource, app: CitadelAppId): Uint8Array {
  const envelope: NodeAppEnvelope = { v: NODE_APP_METADATA_VERSION, kind: KIND, payload: { app } };
  const document: Record<string, unknown> = { ...(metadataDocument(existing) ?? {}), [NODE_APP_METADATA_KEY]: envelope };
  return new TextEncoder().encode(JSON.stringify(document));
}

/**
 * The app a node opens in, or null when it names none. Throws `NodeAppMetadataError` when it
 * names one this client cannot read: a newer envelope version, a foreign kind, an unknown app.
 */
export function decodeNodeApp(metadata: MetadataSource): CitadelAppId | null {
  const document: Record<string, unknown> | null = metadataDocument(metadata);
  if (!document || !(NODE_APP_METADATA_KEY in document)) return null;
  const envelope: unknown = document[NODE_APP_METADATA_KEY];
  if (!isRecord(envelope)) throw new NodeAppMetadataError('The document\'s app record is not an object.');
  if (envelope.v !== NODE_APP_METADATA_VERSION) {
    throw new NodeAppMetadataError(
      `The document's app record is version ${String(envelope.v)}; this version of Citadel reads version ${NODE_APP_METADATA_VERSION}.`,
    );
  }
  if (envelope.kind !== KIND) throw new NodeAppMetadataError(`The document's app record has kind ${String(envelope.kind)}.`);
  const app: unknown = isRecord(envelope.payload) ? envelope.payload.app : undefined;
  if (!isCitadelAppId(app)) throw new NodeAppMetadataError(`The document names an app this version of Citadel does not know: ${String(app)}.`);
  return app;
}

/** What a render path needs: decoding without throwing, the failure kept as a reason to show. */
export type NodeAppState =
  | { kind: 'none' }
  | { kind: 'app'; app: CitadelAppId }
  | { kind: 'unreadable'; reason: string };

export function nodeAppState(metadata: MetadataSource): NodeAppState {
  try {
    const app: CitadelAppId | null = decodeNodeApp(metadata);
    return app === null ? { kind: 'none' } : { kind: 'app', app };
  } catch (error) {
    if (error instanceof NodeAppMetadataError) return { kind: 'unreadable', reason: error.message };
    throw error;
  }
}
