/**
 * Exact types for the workspace `metadata` field.
 *
 * The wire type is `Workspace.metadata: Vec<u8>`, which ts-rs surfaces as
 * `number[]`. The context declared it `Record<string, any>` instead, and that
 * was not merely loose — it was wrong, and it broke something:
 * `getWorkspaceLogo` tested `metadata.logo` on what is actually a byte array, so
 * the property was always undefined and the image branch was unreachable. Every
 * workspace fell back to initials, and no type error was possible because `any`
 * accepts the lookup.
 *
 * Naming the real shape once removes the whole class: a byte array cannot be
 * dotted into by mistake, and a decoder has to say what it is decoding.
 */

/** Raw workspace metadata as it arrives over the wire: `Vec<u8>` as `number[]`. */
export type WorkspaceMetadataBytes = number[];

/**
 * Anything stored in workspace metadata must be a tagged envelope.
 *
 * The field is shared — the theme uses it, and other features may. A reader must
 * therefore be able to tell "this is not mine" from "this is mine but corrupt",
 * which requires the tag to be part of the contract rather than a convention.
 */
export interface MetadataEnvelope<TKind extends string, TPayload> {
  /** Envelope format version, so an older client can decline a newer payload. */
  v: number;
  kind: TKind;
  payload: TPayload;
}

/** Narrow unknown bytes to a decodable string without assuming they are text. */
export function decodeMetadataBytes(bytes: WorkspaceMetadataBytes | Uint8Array | null | undefined): string | null {
  if (!bytes) return null;
  const array: Uint8Array<ArrayBufferLike> = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (array.length === 0) return null;

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(array);
  } catch {
    // Another feature's binary payload, not text. Expected, not exceptional.
    return null;
  }
}
