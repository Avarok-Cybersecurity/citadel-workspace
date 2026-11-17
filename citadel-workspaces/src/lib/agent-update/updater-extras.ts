/**
 * What the agent may report about its updater beyond today's typed `UpdateStatus` and
 * `UpdateAvailable`: an update channel, download progress, a size, release notes and an ML-DSA
 * verdict. The bindings do not carry them yet, so each is read from an untyped object and kept
 * only when it has the right shape. A wrong shape is the same as the agent not saying, and
 * never a claim of verification.
 *
 * Field names, for the agent to add: on the status `channel`, `download_progress` (0..1) or
 * `downloaded_bytes` with `total_bytes`, `ml_dsa_verified`; on the available release
 * `size_bytes`, `release_notes`.
 */
export interface StatusExtras {
  channel?: string;
  /** 0..1. */
  downloadProgress?: number;
  mlDsaVerified?: boolean;
}

export interface AvailableExtras {
  sizeBytes?: number;
  notes?: string;
}

/** The most release-note text a window renders. */
export const MAX_NOTES_CHARS: number = 20_000;

export const SIGSTORE_LABEL: string = 'Sigstore + platform signature';
export const SIGSTORE_AND_ML_DSA_LABEL: string = 'Sigstore + platform signature + ML-DSA';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function count(value: unknown): number | undefined {
  const n: number | undefined = typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : undefined;
  return n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;
}

function fraction(raw: Record<string, unknown>): number | undefined {
  const direct: unknown = raw.download_progress;
  if (typeof direct === 'number' && Number.isFinite(direct)) return Math.min(1, Math.max(0, direct));
  const done: number = Number(raw.downloaded_bytes ?? Number.NaN);
  const total: number | undefined = count(raw.total_bytes);
  return Number.isFinite(done) && total !== undefined ? Math.min(1, Math.max(0, done / total)) : undefined;
}

export function readStatusExtras(status: unknown): StatusExtras {
  const raw: Record<string, unknown> = record(status);
  const out: StatusExtras = {};
  if (typeof raw.channel === 'string' && raw.channel.trim() !== '') out.channel = raw.channel.trim();
  const progress: number | undefined = fraction(raw);
  if (progress !== undefined) out.downloadProgress = progress;
  if (typeof raw.ml_dsa_verified === 'boolean') out.mlDsaVerified = raw.ml_dsa_verified;
  return out;
}

export function readAvailableExtras(available: unknown): AvailableExtras {
  const raw: Record<string, unknown> = record(available);
  const out: AvailableExtras = {};
  const size: number | undefined = count(raw.size_bytes);
  if (size !== undefined) out.sizeBytes = size;
  if (typeof raw.release_notes === 'string' && raw.release_notes.trim() !== '') out.notes = raw.release_notes.slice(0, MAX_NOTES_CHARS);
  return out;
}

/** What "Verified releases" rests on. ML-DSA is named only when the agent has said it checked it. */
export function verificationLabel(extras: Pick<StatusExtras, 'mlDsaVerified'>): string {
  return extras.mlDsaVerified === true ? SIGSTORE_AND_ML_DSA_LABEL : SIGSTORE_LABEL;
}
