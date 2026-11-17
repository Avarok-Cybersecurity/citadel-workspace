/** The font port's browser adapter: a face from the served font directory, sha256-pinned. */
import type { FontFaceEntry, FontSource } from './font-manifest';
import { fetchPinned } from './fetch-pinned';

export function fetchFontSource(baseUrl: string, timeoutMs: number): FontSource {
  return {
    async load(face: FontFaceEntry): Promise<Uint8Array> {
      return new Uint8Array(await fetchPinned(`${baseUrl}${encodeURIComponent(face.file)}`, face.sha256, timeoutMs, `font ${face.file}`));
    },
  };
}
