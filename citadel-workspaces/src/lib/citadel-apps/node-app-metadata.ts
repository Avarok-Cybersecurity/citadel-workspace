/**
 * Which Citadel App a node opens in, kept in the node's `metadata` bytes.
 *
 * Node metadata follows the workspace metadata convention (lib/workspace-metadata): one JSON
 * object whose top-level keys belong to independent features, merged into and never assigned
 * over, and the server stores only a document of that shape (server_ops/node_metadata.rs). The
 * app id lives under its own key as a versioned envelope (types/workspace-metadata), so a
 * reader can tell "no app" from "an app this client cannot read".
 *
 * JSON, not CBOR: the server checks and merges the document as JSON, and the envelope holds
 * only short strings and a small integer, so nothing in it needs CBOR's BigInt support. The
 * envelope's own rules (v1 documents, v2 installed pages) are node-app-envelope.ts.
 */
import type { MetadataEnvelope } from '@/types/workspace-metadata';
import { metadataDocument, type MetadataSource } from '@/lib/workspace-metadata/metadata-document';
import type { CitadelAppId } from './registry';
import {
  NODE_APP_DOCUMENT_VERSION, NODE_APP_KIND, NODE_APP_PAGE_VERSION, readNodeAppEnvelope,
  type NodeAppBinding, type NodeAppPage, type ReadBinding,
} from './node-app-envelope';

export type { NodeAppBinding, NodeAppPage };

export const NODE_APP_METADATA_KEY: 'citadel_app' = 'citadel_app';

type NodeAppEnvelope = MetadataEnvelope<typeof NODE_APP_KIND, { app: CitadelAppId }>;
type NodePageEnvelope = MetadataEnvelope<typeof NODE_APP_KIND, { app: string; install_id: string }>;

/** `existing` with `envelope` under the app key, every other key kept (unreadable or absent: no keys, as the server merges). */
function mergedWith(existing: MetadataSource, envelope: NodeAppEnvelope | NodePageEnvelope): Uint8Array {
  const document: Record<string, unknown> = { ...(metadataDocument(existing) ?? {}), [NODE_APP_METADATA_KEY]: envelope };
  return new TextEncoder().encode(JSON.stringify(document));
}

/** `existing` with the document app set (envelope v1), every other key kept. */
export function encodeNodeApp(existing: MetadataSource, app: CitadelAppId): Uint8Array {
  return mergedWith(existing, { v: NODE_APP_DOCUMENT_VERSION, kind: NODE_APP_KIND, payload: { app } });
}

/**
 * `existing` with the node bound to an installed app's page (envelope v2), every other key kept.
 * Throws for a page this client would itself refuse to read: nothing unreadable is ever written.
 */
export function encodeNodeAppPage(existing: MetadataSource, page: NodeAppPage): Uint8Array {
  const envelope: NodePageEnvelope = { v: NODE_APP_PAGE_VERSION, kind: NODE_APP_KIND, payload: { app: page.app, install_id: page.installId } };
  const read: ReadBinding = readNodeAppEnvelope(envelope);
  if (read.kind !== 'installed') throw new Error(read.kind === 'unreadable' ? read.reason : `${page.app} is not an installed app.`);
  return mergedWith(existing, envelope);
}

/**
 * What a node opens in (node-page-abi.md §2): nothing (`none`, never a default app), a document
 * app (v1), an installed app's page (v2), or a record this client cannot read, with the reason.
 */
export function decodeNodeApp(metadata: MetadataSource): NodeAppBinding {
  const document: Record<string, unknown> | null = metadataDocument(metadata);
  if (!document || !(NODE_APP_METADATA_KEY in document)) return { kind: 'none' };
  return readNodeAppEnvelope(document[NODE_APP_METADATA_KEY]);
}
