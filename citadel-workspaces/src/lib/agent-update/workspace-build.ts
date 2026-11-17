/**
 * Which build of this page is deployed, for the About tab: the content hash in the name of the
 * entry chunk that `/version.json` names (pwa/deployed-version.ts). No manifest, as under the
 * dev server, is a development build.
 */
import { VERSION_MANIFEST_PATH, readDeployedEntry } from '@/lib/pwa/deployed-version';

const HASHED: RegExp = /-([A-Za-z0-9_-]{6,})\.[a-z]+$/;

export function buildLabel(entry: string | null): string {
  if (entry === null) return 'development build';
  const file: string = entry.split('/').pop() ?? entry;
  return HASHED.exec(file)?.[1] ?? file;
}

/** The deployed entry, or null when the server has no manifest (a 404, the SPA shell, offline). */
export async function fetchDeployedEntry(): Promise<string | null> {
  try {
    const response: Response = await fetch(VERSION_MANIFEST_PATH, { cache: 'no-store' });
    if (!response.ok) return null;
    return readDeployedEntry(await response.json());
  } catch {
    return null;
  }
}
