/**
 * A chat file's open and download actions, for its bubble: activating it opens it in the app that
 * opens it (a page app in a dialog over the conversation, so the person keeps their place; an
 * installed app is handed it and shown in its tab, open-installed.ts), else downloads
 * it, saying why when no app opens a file it could have read. The right-click and the "more"
 * button open the same menu.
 */
import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { toast } from 'sonner';
import { extensionOf } from '@/lib/citadel-apps/openers/file-extension';
import { openInInstalled } from '@/lib/citadel-apps/openers/open-installed';
import { activationOf, fileMenuModel, type FileActivation, type FileMenuModel, type FileOpener, type Openers } from '@/lib/citadel-apps/openers/openers';
import type { FileOpeningAppId } from '@/lib/citadel-apps/registry';
import { useFileOpeners, type FileOpeners } from '@/lib/citadel-apps/openers/file-openers-context';
import { chatFileOpeners } from './chat-file-opening';

export interface ChatFileSource {
  readonly name: string;
  /** The MIME type the file was sent with; empty when none was recorded. */
  readonly mime: string;
  /** Where the file is, as the document host names it. */
  readonly fileId: string;
  /** Its bytes, read into the page; null where this conversation cannot read them. */
  readonly read: (() => Promise<Uint8Array>) | null;
  /** Hands the original to the person's computer; null where it cannot. */
  readonly download: (() => void) | null;
}

export interface ChatFileOpening {
  readonly menu: FileMenuModel;
  readonly activate: () => void;
  readonly openIn: (app: FileOpener) => void;
  /** The app the file is open in, or null. */
  readonly openedIn: FileOpeningAppId | null;
  readonly close: () => void;
  readonly menuOpen: boolean;
  readonly setMenuOpen: (open: boolean) => void;
  /** For the bubble: a right-click opens the file's menu instead of the browser's. */
  readonly onContextMenu: (e: MouseEvent) => void;
}

export function useChatFileOpening(source: ChatFileSource): ChatFileOpening {
  const [openedIn, setOpenedIn] = useState<FileOpeningAppId | null>(null);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const { name, read, download } = source;
  // An opened file keeps its original's download beside it, so it is opened only where both can be had.
  const readable: boolean = read !== null && download !== null;
  const { available, lastChoices, installed }: FileOpeners = useFileOpeners();
  const openers: Openers | null = useMemo((): Openers | null => chatFileOpeners(name, readable, available, lastChoices.of(extensionOf(name))), [name, readable, available, lastChoices]);
  const menu: FileMenuModel = useMemo((): FileMenuModel => fileMenuModel(openers, download !== null), [openers, download]);

  const openIn: (app: FileOpener) => void = useCallback((app: FileOpener): void => {
    lastChoices.choose(extensionOf(name), app.id);
    if (app.kind === 'page') { setOpenedIn(app.id); return; }
    if (read === null || installed === null) return;
    openInInstalled(app, { name, mime: source.mime }, read, installed).then((why: string | null): void => {
      if (why !== null) toast.error(`${name} was not opened: ${why}.`);
    }, (error: unknown): void => {
      toast.error(`${name} could not be read for ${app.name}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [name, read, source.mime, lastChoices, installed]);
  const activate: () => void = useCallback((): void => {
    const activation: FileActivation = activationOf(openers);
    if (activation.kind === 'open') { openIn(activation.app); return; }
    if (activation.notice !== null) toast.info(activation.notice);
    download?.();
  }, [openers, openIn, download]);
  const onContextMenu: (e: MouseEvent) => void = useCallback((e: MouseEvent): void => {
    if (!menu.download && menu.open === null) return;
    e.preventDefault();
    setMenuOpen(true);
  }, [menu]);

  return { menu, activate, openIn, openedIn, close: (): void => setOpenedIn(null), menuOpen, setMenuOpen, onContextMenu };
}
