/**
 * A picture's content id from its bytes: `sha256-` and the lowercase hex SHA-256, as cdoc-edit
 * names a picture it holds (editor/images.rs), so an id computed here and the editor's agree.
 */

/** Computes a content id; injected where it is used, so a store's logic stays free of the platform. */
export type ContentIdOf = (bytes: Uint8Array) => Promise<string>;

export const sha256ContentId: ContentIdOf = async (bytes: Uint8Array): Promise<string> => {
  const digest: ArrayBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return `sha256-${Array.from(new Uint8Array(digest), (b: number): string => b.toString(16).padStart(2, '0')).join('')}`;
};
