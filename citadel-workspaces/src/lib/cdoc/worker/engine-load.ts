/**
 * The one message the Citadel Docs worker sends unasked: how far its engine's download has got,
 * then that the engine is up. It carries no request id, so WorkerCdocClient (which matches
 * replies by id) never takes it for an answer, and the page's loading bar reads it instead.
 */
import type { ByteProgress } from '@/lib/app-loading/load-stage';

export type EngineLoad =
  /** No request has needed the engine yet. */
  | { readonly kind: 'waiting' }
  | { readonly kind: 'downloading'; readonly bytes: ByteProgress }
  | { readonly kind: 'ready' };

export interface EngineLoadMessage {
  readonly engineLoad: Exclude<EngineLoad, { kind: 'waiting' }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export function isEngineLoadMessage(value: unknown): value is EngineLoadMessage {
  if (!isRecord(value) || 'id' in value || !isRecord(value.engineLoad)) return false;
  const load: Record<string, unknown> = value.engineLoad;
  if (load.kind === 'ready') return true;
  if (load.kind !== 'downloading' || !isRecord(load.bytes)) return false;
  const total: unknown = load.bytes.total;
  return typeof load.bytes.loaded === 'number' && (total === null || typeof total === 'number');
}
