/**
 * Fetches a served asset and refuses it unless its sha256 is the one its manifest pins, so a
 * stale or tampered face or pattern file can never lay a document out differently from the one
 * every other reader uses. Shared by the font and pattern browser adapters.
 */

function hex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (b: number): string => b.toString(16).padStart(2, '0')).join('');
}

export async function fetchPinned(url: string, sha256: string, timeoutMs: number, what: string): Promise<ArrayBuffer> {
  const response: Response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status}`);
  const bytes: ArrayBuffer = await response.arrayBuffer();
  const sha: string = hex(await crypto.subtle.digest('SHA-256', bytes));
  if (sha !== sha256) throw new Error(`${what}: sha256 ${sha} is not the manifest's ${sha256}`);
  return bytes;
}
