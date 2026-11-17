/**
 * The workspace metadata as a JSON object, however it arrived.
 *
 * `Workspace.metadata` is one JSON document shared by several features (`initialized`, `theme`,
 * `logo`). It reaches the client as a byte array (`Vec<u8>`), sometimes as a plain number array,
 * and after a cross-tab sync as the already-decoded object. Every reader decoded it separately,
 * and one of them tested `Array.isArray`, which is false for a `Uint8Array`, so typed-array bytes
 * read as "no metadata".
 */
export type MetadataSource = Uint8Array | number[] | Record<string, unknown> | null | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The decoded document, or null when there is none or it is not a JSON object. */
export function metadataDocument(metadata: MetadataSource): Record<string, unknown> | null {
  if (!metadata) return null;
  // ArrayBuffer.isView, not `instanceof Uint8Array`: a typed array from another realm (the WASM
  // bindings, a worker, jsdom) fails instanceof while being a perfectly good byte array.
  if (!ArrayBuffer.isView(metadata) && !Array.isArray(metadata)) return isRecord(metadata) ? metadata : null;
  const array: Uint8Array<ArrayBuffer> = new Uint8Array(metadata as ArrayLike<number>);
  if (array.length === 0) return null;
  try {
    const document: unknown = JSON.parse(new TextDecoder().decode(array));
    return isRecord(document) ? document : null;
  } catch {
    // A general-purpose field: another producer's bytes landing here is expected, not exceptional.
    return null;
  }
}
