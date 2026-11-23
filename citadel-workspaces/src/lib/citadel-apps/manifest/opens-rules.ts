/**
 * `opens`, the files an app opens: `opens_problem` (citadel-workspace-types/src/apps_opens.rs),
 * mirrored rule for rule and held to the shared cases (apps/catalogue/fixtures/manifest-cases.json)
 * like every other manifest field.
 */
import type { AppSurface, FileOpens } from 'citadel-workspace-client-ts';
import { distinct } from './manifest-rules-parts';

export const MAX_OPENS_EXTENSIONS: number = 64;
export const MAX_EXTENSION_CHARS: number = 16;
export const MAX_OPEN_FILE_BYTES: bigint = 256n * 1024n * 1024n;

function extensionProblem(extension: string): string | null {
  if (extension === '') return 'an empty extension';
  if (new TextEncoder().encode(extension).length > MAX_EXTENSION_CHARS) return `an extension longer than ${MAX_EXTENSION_CHARS} characters`;
  if (extension.startsWith('.')) return `"${extension}" starts with a dot`;
  if (/[A-Z]/.test(extension)) return `"${extension}" is not lower-case`;
  if (!/^[a-z0-9]+$/.test(extension)) return `"${extension}" holds a character other than a-z and 0-9`;
  return null;
}

export function opensProblem(opens: FileOpens, surfaces: readonly AppSurface[]): string | null {
  const count: number = opens.extensions.length;
  if (count === 0 || count > MAX_OPENS_EXTENSIONS) return `${count} extensions, not 1 to ${MAX_OPENS_EXTENSIONS}`;
  for (const extension of opens.extensions) {
    const why: string | null = extensionProblem(extension);
    if (why !== null) return why;
  }
  if (!distinct(opens.extensions)) return 'an extension is listed twice';
  if (!surfaces.includes(opens.surface)) return 'its surface is not one the app paints, so nothing would show an opened file';
  if (opens.max_bytes === 0n || opens.max_bytes > MAX_OPEN_FILE_BYTES) return `max_bytes is not within 1..=${MAX_OPEN_FILE_BYTES}`;
  return null;
}
