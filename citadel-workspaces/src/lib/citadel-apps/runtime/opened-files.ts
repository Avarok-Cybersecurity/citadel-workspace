/**
 * A file a member chose to open in an app reaches it here, whichever ABI the app speaks: the page
 * offers the file to the app (by its id: the member chose the app, not one of its installs), and
 * the app's mounted instance takes it, a worker app as AppEvent `open_file` (mount-steps.ts), a
 * glue app through the taker it registers (the Calendar's tab). A file offered before the instance
 * runs waits for it; each file is taken once, by the instance that registered last. Both take
 * through `takeDeclared`, so the app's signed manifest (`opens`) decides whether it is handed over.
 */
import type { AppSurface, FileOpens } from 'citadel-workspace-client-ts';
import type { AppEvent } from '../sdk/generated/AppEvent';
import { extensionOf } from '../openers/file-extension';

/** What reaches the app: AppEvent `open_file`'s name, MIME type (empty when none was recorded) and bytes. */
export type OpenedFile = Readonly<Extract<AppEvent, { open_file: unknown }>['open_file']>;

/** Why `file` may not be handed to an app on `surface` that declared `opens`, or null when it may. */
export function openedFileProblem(opens: FileOpens | undefined, surface: AppSurface, file: OpenedFile): string | null {
  if (opens === undefined) return 'the app opens no files';
  if (opens.surface !== surface) return `the app opens files on ${opens.surface}, not on ${surface}`;
  const extension: string = extensionOf(file.name);
  if (!opens.extensions.includes(extension)) return extension === '' ? 'the app opens no files without an extension' : `the app does not open .${extension} files`;
  if (BigInt(file.bytes.byteLength) > opens.max_bytes) return `the file is larger than the ${opens.max_bytes} bytes the app opens`;
  return null;
}

export type OpenedFileTaker = (file: OpenedFile) => void;

export class OpenedFiles {
  private readonly waiting: Map<string, OpenedFile> = new Map<string, OpenedFile>();
  private readonly takers: Map<string, OpenedFileTaker> = new Map<string, OpenedFileTaker>();

  offer(appId: string, file: OpenedFile): void {
    const taker: OpenedFileTaker | undefined = this.takers.get(appId);
    if (taker === undefined) this.waiting.set(appId, file);
    else taker(file);
  }

  /** Hands `taker` the file waiting for the install, if any, and every one offered until it stops. */
  take(appId: string, taker: OpenedFileTaker): () => void {
    this.takers.set(appId, taker);
    const waiting: OpenedFile | undefined = this.waiting.get(appId);
    if (waiting !== undefined) {
      this.waiting.delete(appId);
      taker(waiting);
    }
    return (): void => {
      if (this.takers.get(appId) === taker) this.takers.delete(appId);
    };
  }
}

/**
 * `deliver` is handed each file offered to `appId` that its declaration allows on `surface`;
 * `refuse` is told of each one it does not, and why. Returns the stop.
 */
export function takeDeclared(inbox: OpenedFiles, appId: string, opens: FileOpens | undefined, surface: AppSurface, deliver: OpenedFileTaker, refuse: (file: OpenedFile, why: string) => void): () => void {
  return inbox.take(appId, (file: OpenedFile): void => {
    const why: string | null = openedFileProblem(opens, surface, file);
    if (why === null) deliver(file);
    else refuse(file, why);
  });
}
