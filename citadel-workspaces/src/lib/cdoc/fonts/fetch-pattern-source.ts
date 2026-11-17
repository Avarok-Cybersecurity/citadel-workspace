/** The pattern port's browser adapter: a pattern file from the served directory, sha256-pinned, as UTF-8 text. */
import type { PatternEntry, PatternSource } from './pattern-manifest';
import { fetchPinned } from './fetch-pinned';

export function fetchPatternSource(baseUrl: string, timeoutMs: number): PatternSource {
  const utf8: TextDecoder = new TextDecoder('utf-8', { fatal: true });
  return {
    async load(entry: PatternEntry): Promise<string> {
      return utf8.decode(await fetchPinned(`${baseUrl}${encodeURIComponent(entry.file)}`, entry.sha256, timeoutMs, `hyphenation patterns ${entry.file}`));
    },
  };
}
