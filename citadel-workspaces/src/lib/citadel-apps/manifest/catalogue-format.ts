/**
 * The global catalogue's format: apps/catalogue/catalogue.json in the parent repository, served as
 * /apps/catalogue.json. One entry per app: its id and version (readable in review), where its
 * manifest is published, the manifest's exact bytes (what the publisher signed, and what is shown)
 * and the publisher's detached signature.
 *
 * Read by the marketplace and by scripts/check-app-catalogue.mjs alike, so CI refuses exactly the
 * entries the marketplace would drop. Relative imports only (the check script bundles this file).
 */
import type { AppManifest } from 'citadel-workspace-client-ts';
import { isHttpsUrl } from './net-rules';
import { readManifestBytes, type ManifestReading } from './manifest-rules';

export const CATALOGUE_FORMAT: number = 1;
/** An ML-DSA-65 signature is 3309 bytes, published as lowercase hex. */
export const SIGNATURE_HEX_CHARS: number = 6618;
const ENTRY_KEYS: readonly string[] = ['id', 'version', 'manifest_url', 'manifest_base64', 'signature'];
const BASE64: RegExp = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface CatalogueEntry {
  id: string;
  version: string;
  manifest_url: string;
  manifest_base64: string;
  signature: string;
}

export interface ReadEntry {
  entry: CatalogueEntry;
  manifestBytes: Uint8Array;
  manifest: AppManifest;
}

export type CatalogueReading =
  | { ok: true; catalogueVersion: bigint; entries: ReadEntry[]; problems: string[] }
  | { ok: false; why: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function decodeBase64(text: string): Uint8Array | null {
  if (!BASE64.test(text)) return null;
  return Uint8Array.from(atob(text), (c: string) => c.charCodeAt(0));
}

/** One entry, or the reason it is refused. */
export function readEntry(value: unknown, at: number): ReadEntry | string {
  const where: string = `entry ${at}`;
  if (!isRecord(value) || Object.keys(value).length !== ENTRY_KEYS.length || !ENTRY_KEYS.every((k: string) => typeof value[k] === 'string')) {
    return `${where}: not exactly { ${ENTRY_KEYS.join(', ')} }, all strings`;
  }
  const entry: CatalogueEntry = value as unknown as CatalogueEntry;
  const label: string = `${where} (${entry.id})`;
  if (!isHttpsUrl(entry.manifest_url, 2048)) return `${label}: manifest_url is not an https URL`;
  if (entry.signature.length !== SIGNATURE_HEX_CHARS || !/^[0-9a-f]*$/.test(entry.signature)) return `${label}: signature is not ${SIGNATURE_HEX_CHARS} lowercase hex characters`;
  const bytes: Uint8Array | null = decodeBase64(entry.manifest_base64);
  if (bytes === null) return `${label}: manifest_base64 is not standard padded base64`;
  const reading: ManifestReading = readManifestBytes(bytes);
  if (!reading.ok) return `${label}: the manifest is refused at ${reading.field}: ${reading.why}`;
  if (reading.manifest.id !== entry.id || reading.manifest.version !== entry.version) return `${label}: id and version differ from the manifest's (${reading.manifest.id} ${reading.manifest.version})`;
  if (reading.manifest.audience.kind !== 'global') return `${label}: a global listing's audience must be global`;
  return { entry, manifestBytes: bytes, manifest: reading.manifest };
}

/**
 * The catalogue in `text`. A file of the wrong shape is refused whole; an entry that is wrong is
 * left out and named in `problems`, as is a second entry for an id.
 */
export function readCatalogue(text: string): CatalogueReading {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, why: 'the catalogue is not JSON' };
  }
  if (!isRecord(value) || Object.keys(value).sort().join() !== 'catalogue_version,entries,format') return { ok: false, why: 'the catalogue is not exactly { format, catalogue_version, entries }' };
  if (value.format !== CATALOGUE_FORMAT) return { ok: false, why: `the catalogue's format is not ${CATALOGUE_FORMAT}` };
  const version: unknown = value.catalogue_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return { ok: false, why: 'catalogue_version is not a positive integer' };
  if (!Array.isArray(value.entries)) return { ok: false, why: 'entries is not a list' };
  const entries: ReadEntry[] = [];
  const problems: string[] = [];
  const seen: Set<string> = new Set();
  value.entries.forEach((raw: unknown, at: number) => {
    const read: ReadEntry | string = readEntry(raw, at);
    if (typeof read === 'string') { problems.push(read); return; }
    if (seen.has(read.entry.id)) { problems.push(`entry ${at} (${read.entry.id}): a second entry for this id`); return; }
    seen.add(read.entry.id);
    entries.push(read);
  });
  return { ok: true, catalogueVersion: BigInt(version), entries, problems };
}
