/**
 * How far an app's pane has got with loading, and what its loading indicator says about it. Pure:
 * the pane renders `loadingView`, and every app's loader states its progress as a LoadStage.
 *
 * Only a download whose size is known is measured (a determinate bar). The rest -- the app's
 * code arriving, the document opening -- has no honest fraction, so it is shown as underway
 * without one rather than with an invented percentage.
 */
import { formatBytes } from '@/lib/format-bytes';

/** Bytes of one download; `total` is null when the server did not say how many are coming. */
export interface ByteProgress {
  readonly loaded: number;
  readonly total: number | null;
}

export type LoadStage =
  /** The app's own code is arriving. */
  | { readonly kind: 'app' }
  /** The app's engine (a WebAssembly binary) is downloading. */
  | { readonly kind: 'engine'; readonly bytes: ByteProgress | null }
  /** The app is up and opening the document: its records, fonts and first pages. */
  | { readonly kind: 'document' };

export interface LoadingView {
  /** What is happening, in a sentence a person reads. */
  readonly label: string;
  /** Measured detail, as "1.2 MB of 3.9 MB"; null when there is nothing measured to add. */
  readonly detail: string | null;
  /** Done so far, 0 to 1; null when the stage has no honest fraction (an indeterminate bar). */
  readonly fraction: number | null;
}

function measured(bytes: ByteProgress | null): { readonly detail: string | null; readonly fraction: number | null } {
  if (bytes === null) return { detail: null, fraction: null };
  if (bytes.total === null || bytes.total <= 0) return { detail: `${formatBytes(bytes.loaded)} downloaded`, fraction: null };
  const loaded: number = Math.min(bytes.loaded, bytes.total);
  return { detail: `${formatBytes(loaded)} of ${formatBytes(bytes.total)}`, fraction: loaded / bytes.total };
}

export function loadingView(appName: string, stage: LoadStage): LoadingView {
  switch (stage.kind) {
    case 'app':
      return { label: `Loading ${appName}…`, detail: null, fraction: null };
    case 'engine':
      return { label: `Downloading the ${appName} engine…`, ...measured(stage.bytes) };
    case 'document':
      return { label: 'Opening the document…', detail: null, fraction: null };
  }
}
