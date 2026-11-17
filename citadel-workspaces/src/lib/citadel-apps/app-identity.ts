/**
 * An app's id and version, read as the Rust crate `citadel-app-id` reads them: an id is
 * `^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$` of at most 64 characters, a version is
 * `MAJOR.MINOR.PATCH` in decimal with no leading zeros, each part a u32, no suffix.
 */

export const MAX_APP_ID_CHARS: number = 64;
const APP_ID: RegExp = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
const PART: string = '(0|[1-9][0-9]{0,9})';
const VERSION: RegExp = new RegExp(`^${PART}\\.${PART}\\.${PART}$`);
const U32_MAX: number = 4_294_967_295;

export interface AppVersion { major: number; minor: number; patch: number }

export function isAppId(id: string): boolean {
  return id.length <= MAX_APP_ID_CHARS && APP_ID.test(id);
}

export function parseAppVersion(text: string): AppVersion | null {
  const match: RegExpExecArray | null = VERSION.exec(text);
  if (match === null) return null;
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number);
  if ([major, minor, patch].some((n: number) => n > U32_MAX)) return null;
  return { major, minor, patch };
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareVersions(a: AppVersion, b: AppVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** "1.2+" for a floor of 1.2.0, "1.2.3+" for 1.2.3: how a requirement is shown. */
export function versionFloorLabel(floor: AppVersion): string {
  return floor.patch === 0 ? `${floor.major}.${floor.minor}+` : `${floor.major}.${floor.minor}.${floor.patch}+`;
}

/**
 * An id a scope or audience names, as the kernel's `scope_key` accepts it: 1..=128 printable
 * ASCII characters and no `/`.
 */
export function isScopeId(id: string): boolean {
  return id.length >= 1 && id.length <= 128 && /^[\x21-\x7e]+$/.test(id) && !id.includes('/');
}
