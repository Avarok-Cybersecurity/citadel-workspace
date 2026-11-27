import type { WorkspaceProtocolPayload } from './types/workspace-types.js';

/**
 * The workspace protocol's codec: the Rust module built from citadel-workspace-types
 * (citadel-workspace-codec, vendored in ../codec by scripts/build-workspace-codec.mjs).
 *
 * The kernel reads and writes serde_json over those types. Decoding through the same types
 * means a payload that is not one is refused here rather than cast, every u64 the types declare
 * arrives as an exact bigint (no list of field names to keep in step), and byte fields arrive
 * as Uint8Array. The JSON itself is unchanged.
 *
 * Loaded once, off the landing path: WorkspaceClient.init awaits loadWorkspaceCodec() before it
 * opens the connection, so no workspace message can arrive before the codec is ready. Encoding
 * or decoding before that throws rather than guessing.
 */

type Codec = typeof import('../codec/workspace_codec.js');

/** Where the binary is served (and precached); scripts/build-workspace-codec.mjs writes it into the glue. */
export const WORKSPACE_CODEC_WASM_URL: string = '/workspace-codec/workspace_codec_bg.wasm';

let codec: Codec | null = null;
let loading: Promise<Codec> | null = null;

async function importCodec(): Promise<Codec> {
  return import('../codec/workspace_codec.js');
}

/** Loads and instantiates the codec from its served URL; later calls share the first load. */
export async function loadWorkspaceCodec(): Promise<void> {
  loading ??= importCodec().then(async (module: Codec): Promise<Codec> => {
    await module.default({ module_or_path: WORKSPACE_CODEC_WASM_URL });
    return module;
  });
  codec = await loading;
}

/** Instantiates the codec from the binary's bytes, where there is no server to fetch it from (tests, tools). */
export async function loadWorkspaceCodecFrom(binary: BufferSource): Promise<void> {
  const module: Codec = await importCodec();
  module.initSync({ module: binary });
  codec = module;
}

function ready(): Codec {
  if (codec === null) throw new Error('The workspace codec is not loaded: await loadWorkspaceCodec() first.');
  return codec;
}

/** A workspace protocol payload as the JSON bytes the kernel reads. Throws if it is not one. */
export function encodeWorkspacePayload(payload: WorkspaceProtocolPayload): Uint8Array {
  return ready().encode_workspace_payload(payload);
}

/** Workspace protocol JSON bytes as a payload the protocol's types accept. Throws if they are not one. */
export function decodeWorkspacePayload(bytes: Uint8Array): WorkspaceProtocolPayload {
  // The value was built by serde from WorkspaceProtocolPayload itself: the annotation states
  // what the decoder checked, it does not assume it.
  const payload: unknown = ready().decode_workspace_payload(bytes);
  return payload as WorkspaceProtocolPayload;
}
