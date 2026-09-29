/**
 * What a reliable P2P payload is, so the WASM client can pick a codec from the
 * ILM policy table: "json", "text" and "yjs-update" are compressed; "opaque"
 * and "cbor-command" are sent as they are. The WASM client rejects any other
 * string, and an absent hint means no compression.
 *
 * The agent's typescript-client exports the same union from 099ec2f on, but
 * the submodule pointer here predates it. When the pointer passes that commit,
 * delete this file and the sendP2PMessageReliable override in WorkspaceClient:
 * both are then inherited, and the `export *` in index.ts carries the type.
 */
export type CompressionHint = 'opaque' | 'text' | 'json' | 'yjs-update' | 'cbor-command';
