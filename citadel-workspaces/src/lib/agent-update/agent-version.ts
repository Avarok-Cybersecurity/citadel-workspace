/**
 * Agent versions, compared as the agent compares them (its updater's version.rs): three whole
 * numbers, never text, so 0.13.0 is newer than 0.9.9. Pure.
 */
export type Triple = readonly [number, number, number];

const SEMVER: RegExp = /^(\d+)\.(\d+)\.(\d+)$/;

/** `MAJOR.MINOR.PATCH`, or null for anything else (a prerelease, a build tag, garbage). */
export function parseVersion(text: string): Triple | null {
  const m: RegExpExecArray | null = SEMVER.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** `candidate` is a newer version than `current`. False when either is not a version. */
export function isNewer(candidate: string, current: string): boolean {
  const a: Triple | null = parseVersion(candidate);
  const b: Triple | null = parseVersion(current);
  return a !== null && b !== null && compare(a, b) > 0;
}

/** `version` is `target` or newer. False when either is not a version. */
export function isAtLeast(version: string, target: string): boolean {
  const a: Triple | null = parseVersion(version);
  const b: Triple | null = parseVersion(target);
  return a !== null && b !== null && compare(a, b) >= 0;
}
