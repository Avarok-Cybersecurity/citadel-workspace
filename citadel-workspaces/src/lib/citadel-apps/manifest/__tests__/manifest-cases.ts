/** The shared manifest cases' format, and the bytes one case stands for. */

export interface ManifestCase {
  name: string;
  expect: string;
  set?: Array<{ path: Array<string | number>; value: unknown }>;
  remove?: Array<Array<string | number>>;
  raw?: string;
}

export interface ManifestCases { base: Record<string, unknown>; cases: ManifestCase[] }

type Container = Record<string | number, unknown>;

function parentOf(root: Container, path: Array<string | number>): Container {
  return path.slice(0, -1).reduce((at: Container, key: string | number): Container => at[key] as Container, root);
}

/** The base with the case's one change, as the bytes `AppManifest::from_bytes` is given. */
export function manifestCaseBytes(base: Record<string, unknown>, c: ManifestCase): Uint8Array {
  if (c.raw !== undefined) return new TextEncoder().encode(c.raw);
  const value: Container = structuredClone(base) as Container;
  for (const { path, value: v } of c.set ?? []) parentOf(value, path)[path[path.length - 1]] = v;
  for (const path of c.remove ?? []) delete parentOf(value, path)[path[path.length - 1]];
  return new TextEncoder().encode(JSON.stringify(value));
}
