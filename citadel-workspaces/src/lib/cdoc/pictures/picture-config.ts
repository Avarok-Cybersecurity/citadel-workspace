/**
 * How a document's pictures are fetched, stated once.
 *
 * - `fetchConcurrency`: pictures fetched at once per document. Three: a page of photos fills in
 *   a few at a time, and a document of hundreds never floods its store with requests.
 * - `retryAfterMs`: how long a picture whose store could not be reached (offline, or the store
 *   not answering) waits before a repaint may ask again. A picture that is not there, or that
 *   the member may not see, is not asked again while the document stays open.
 */
export interface PictureLimits {
  readonly fetchConcurrency: number;
  readonly retryAfterMs: number;
}

export const PICTURE_LIMITS: PictureLimits = {
  fetchConcurrency: 3,
  retryAfterMs: 10_000,
};
