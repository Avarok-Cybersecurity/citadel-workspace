/**
 * Opening a file in an installed app: its bytes are read, held to the app's declared size, handed
 * to the app (the page's opened-files inbox, runtime/opened-files.ts) and the app's tab is shown,
 * on its install's node or, for a workspace-wide install, on `fallbackNode`. Every effect is passed
 * in (SBIO). Resolves with what the person is told when it could not, else null.
 */
import type { OpenedFile, OpenedFiles } from '../runtime/opened-files';
import { appTabPath } from './installed-openers';
import type { FileOpener } from './openers';

export interface InstalledOpening {
  readonly inbox: OpenedFiles;
  readonly go: (path: string) => void;
  /** Where a workspace-wide app's tab is shown: the first space the member sees; null with none. */
  readonly fallbackNode: string | null;
}

export async function openInInstalled(app: Extract<FileOpener, { kind: 'installed' }>, file: Omit<OpenedFile, 'bytes'>, read: () => Promise<Uint8Array>, o: InstalledOpening): Promise<string | null> {
  const node: string | null = app.where ?? o.fallbackNode;
  if (node === null) return `${app.name} opens files in a page's tab, and there is no page here to open it on`;
  const bytes: Uint8Array = await read();
  if (BigInt(bytes.byteLength) > app.maxBytes) return `${file.name} is larger than ${app.name} opens`;
  o.inbox.offer(app.id, { ...file, bytes });
  o.go(appTabPath(node, app.id));
  return null;
}
