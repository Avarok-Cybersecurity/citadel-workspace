/**
 * The Calendar's end of the page's opened-files inbox (lib/citadel-apps/runtime/opened-files.ts):
 * the glue tab takes the files a member opened in the Calendar, as a worker app's mount does, held
 * to the same rule (`takeDeclared`, from its verified manifest's `opens` on its node tab). The file
 * is kept until the member has reviewed it; one refused is said in a toast, never shown.
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { AppManifest } from 'citadel-workspace-client-ts';
import { takeDeclared, type OpenedFile, type OpenedFiles } from '@/lib/citadel-apps/runtime/opened-files';

export interface OpenedFileState {
  readonly file: OpenedFile | null;
  readonly done: () => void;
}

export function useOpenedFile(inbox: OpenedFiles, appId: string, manifest: AppManifest): OpenedFileState {
  const [file, setFile] = useState<OpenedFile | null>(null);
  useEffect(() => takeDeclared(inbox, appId, manifest.opens, 'node_tab', setFile, (refused: OpenedFile, why: string): void => {
    toast.error(`${manifest.name} did not open ${refused.name}: ${why}.`);
  }), [inbox, appId, manifest]);
  const done: () => void = useCallback((): void => setFile(null), []);
  return { file, done };
}
