/**
 * Which app opens a file: the one lookup every surface (file manager, chat files) asks. Pure
 * (SBIO): the apps available here and the person's last choice are handed in, and the answer is
 * an ordered list, the preferred opener first.
 *
 * Preference: the app the person last chose for this extension on this device (last-choice.ts),
 * when it still opens it; then
 * first-party apps before others; then the order the apps were given in.
 */
import type { ComponentType } from 'react';
import type { FileOpeningAppId } from '../registry';
import { extensionOf } from './file-extension';

/** An app that opens files, by the id its surface hands a file to. */
export interface Opener<Id extends string> {
  readonly id: Id;
  readonly name: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly firstParty: boolean;
  /** Canonical extensions (opens-declaration), checked when the app was registered. */
  readonly opens: readonly string[];
}

/**
 * An app that opens files, as a surface hands it one: an app built into the page (`page`, opened
 * where the surface shows files), or an installed Citadel App, handed the file and shown in its
 * node tab (installed-openers.ts).
 */
export type FileOpener =
  | (Opener<FileOpeningAppId> & { readonly kind: 'page' })
  | (Opener<string> & {
    readonly kind: 'installed';
    /** Its manifest's `opens.max_bytes`: a larger file is not handed to it. */
    readonly maxBytes: bigint;
    /** The node its install is on, whose tab shows it; null for a workspace-wide install. */
    readonly where: string | null;
  });

export interface OpenersOf<T extends Opener<string>> {
  /** The file's extension, '' when it has none. */
  readonly extension: string;
  /** Every app here that opens it, the preferred one first; empty when none does. */
  readonly apps: readonly T[];
}

export type Openers = OpenersOf<FileOpener>;

export function openersFor<T extends Opener<string>>(fileName: string, available: readonly T[], lastChoice: string | null): OpenersOf<T> {
  const extension: string = extensionOf(fileName);
  if (extension === '') return { extension, apps: [] };
  const matching: T[] = available.filter((app: T): boolean => app.opens.includes(extension));
  const rank = (app: T): number => (app.id === lastChoice ? 0 : app.firstParty ? 1 : 2);
  // Array.prototype.sort is stable, so equal ranks keep the order they were given in.
  return { extension, apps: matching.sort((a: T, b: T): number => rank(a) - rank(b)) };
}

/**
 * What a file's menu offers: Download always (where the file can be had), Open only with an app,
 * Open with… only with several. `openers` is null where no app could read the file's bytes here.
 */
export interface FileMenuModelOf<T extends Opener<string>> {
  readonly open: T | null;
  readonly openWith: readonly T[];
  readonly download: boolean;
}

export type FileMenuModel = FileMenuModelOf<FileOpener>;

export function fileMenuModel<T extends Opener<string>>(openers: OpenersOf<T> | null, downloadable: boolean): FileMenuModelOf<T> {
  const apps: readonly T[] = openers?.apps ?? [];
  return { open: apps[0] ?? null, openWith: apps.length > 1 ? apps : [], download: downloadable };
}

export function openLabel(app: Opener<string>): string {
  return `Open in ${app.name}`;
}

/**
 * What activating a file (click, Enter, double-click) does. A download says why it is not opening
 * only when no app opens a file whose bytes could have been read; where they could not (openers
 * null), an app might open it, so nothing is claimed.
 */
export type FileActivationOf<T extends Opener<string>> =
  | { readonly kind: 'open'; readonly app: T }
  | { readonly kind: 'download'; readonly notice: string | null };

export type FileActivation = FileActivationOf<FileOpener>;

export function noOpenerNotice(extension: string): string {
  const kind: string = extension === '' ? 'files without an extension' : `.${extension} files`;
  return `Downloading instead — no app here opens ${kind}`;
}

export function activationOf<T extends Opener<string>>(openers: OpenersOf<T> | null): FileActivationOf<T> {
  if (openers === null) return { kind: 'download', notice: null };
  const app: T | undefined = openers.apps[0];
  return app === undefined ? { kind: 'download', notice: noOpenerNotice(openers.extension) } : { kind: 'open', app };
}
