/**
 * The file openers a surface that shows files asks (the file manager, chat files), provided once
 * for the workspace (FileOpenersProvider.tsx). Where none is provided, a page outside the workspace,
 * only the apps built into the page open files: no installed app reaches the member there.
 */
import { createContext, useContext } from 'react';
import { BUILT_IN_OPENERS } from './built-in-openers';
import { deviceLastChoices, type LastChoices } from './last-choice';
import type { InstalledOpening } from './open-installed';
import type { FileOpener } from './openers';

export interface FileOpeners {
  readonly available: readonly FileOpener[];
  readonly lastChoices: LastChoices;
  /** How an installed app is handed a file and shown; null where none is installed here. */
  readonly installed: InstalledOpening | null;
}

const OUTSIDE_A_WORKSPACE: FileOpeners = { available: BUILT_IN_OPENERS, lastChoices: deviceLastChoices, installed: null };

export const FileOpenersContext: React.Context<FileOpeners | null> = createContext<FileOpeners | null>(null);

export function useFileOpeners(): FileOpeners {
  return useContext(FileOpenersContext) ?? OUTSIDE_A_WORKSPACE;
}
