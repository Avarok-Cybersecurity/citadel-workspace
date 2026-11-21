/**
 * What the consent dialog names: the identity, as the person can read it aloud, and this device.
 */

/** `3forj6ftckvpoy2r` → `3for-j6ft-ckvp-oy2r` (identity-api.md §4 `fingerprint_grouped`). */
export function groupFingerprint(idFp: string): string {
  return idFp.match(/.{1,4}/g)?.join('-') ?? idFp;
}

const BROWSERS: readonly [RegExp, string][] = [
  [/Edg\//, 'Edge'], [/OPR\//, 'Opera'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Safari\//, 'Safari'],
];
const SYSTEMS: readonly [RegExp, string][] = [
  [/iPhone|iPad/, 'iOS'], [/Android/, 'Android'], [/Macintosh|Mac OS X/, 'macOS'], [/Windows/, 'Windows'], [/CrOS/, 'ChromeOS'], [/Linux/, 'Linux'],
];

const first = (userAgent: string, table: readonly [RegExp, string][]): string | null =>
  table.find(([pattern]: [RegExp, string]) => pattern.test(userAgent))?.[1] ?? null;

/** "Chrome on macOS", from the browser's own description of itself; "this browser" when it says nothing known. */
export function describeDevice(userAgent: string): string {
  const browser: string | null = first(userAgent, BROWSERS);
  const system: string | null = first(userAgent, SYSTEMS);
  if (browser !== null && system !== null) return `${browser} on ${system}`;
  return browser ?? (system !== null ? `a browser on ${system}` : 'this browser');
}
