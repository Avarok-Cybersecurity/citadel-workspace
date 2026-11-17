/**
 * Which build is deployed, told apart from which build this page is running.
 *
 * The build writes `/version.json` naming its entry chunk (vite.config.ts). The
 * entry's file name carries a content hash that Rollup derives from everything
 * it imports, so it changes whenever the shipped code does and stays the same
 * when it does not — no build counter, clock or environment variable to set. A
 * running page knows its own entry from `import.meta.url` in main.tsx, so the
 * id never has to be baked into the bundle it identifies.
 *
 * Why a file and a poll, rather than the service worker alone: the worker only
 * exists after a first visit, in a secure context, where registration did not
 * fail, and only under a build that registers one. A tab without it — a first
 * visit, a browser that refused it — never learned a deploy had happened. The
 * file is a few dozen bytes, served statically, fetched with `no-store`.
 */
export const VERSION_MANIFEST_PATH: string = '/version.json';

/**
 * `seq` is the build's clock (multi-instance/build-identity.ts). `minSeq`, when present, is the
 * kill switch: a page running a build older than it reloads at once (kill-switch.ts). Absent,
 * no build is too old to keep running.
 */
export interface VersionManifest {
  readonly entry: string;
  readonly seq: number;
  readonly minSeq?: number;
}

export function versionManifest(manifest: VersionManifest): string {
  return JSON.stringify(manifest satisfies VersionManifest);
}

function seqField(body: Record<string, unknown>, key: 'seq' | 'minSeq'): number | null {
  const value: unknown = body[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** The deployed build's seq and kill switch; null for either one the manifest does not carry. */
export function readDeployedSeqs(body: unknown): { seq: number | null; minSeq: number | null } {
  if (typeof body !== 'object' || body === null) return { seq: null, minSeq: null };
  const fields: Record<string, unknown> = body as Record<string, unknown>;
  return { seq: seqField(fields, 'seq'), minSeq: seqField(fields, 'minSeq') };
}

/** The deployed entry, or null for anything that is not a manifest (a 404 page, the SPA shell). */
export function readDeployedEntry(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const entry: unknown = (body as Record<string, unknown>).entry;
  return typeof entry === 'string' && entry.length > 0 ? entry : null;
}

function pathOf(url: string, origin: string): string {
  return new URL(url, origin).pathname;
}

/**
 * True only when the server names a different entry than the one running. An
 * unreadable manifest is not evidence of a deploy: in development there is no
 * manifest and Vite answers with index.html.
 */
export function isNewDeploy(runningEntry: string, deployedEntry: string | null, origin: string): boolean {
  if (deployedEntry === null) return false;
  return pathOf(runningEntry, origin) !== pathOf(deployedEntry, origin);
}
