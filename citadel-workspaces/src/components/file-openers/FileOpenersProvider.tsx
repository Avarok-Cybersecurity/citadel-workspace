/**
 * The workspace's file openers, for every surface that shows files (file-openers-context.ts): the
 * apps built into the page and the installed apps that open files, read from the server's installs
 * and their signed listings (again whenever an install changes), the person's last choices on this
 * device, and how an installed app is handed a file and shown (open-installed.ts) by client-side
 * navigation. Mounted once inside the router (App.tsx).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { eventEmitter } from '@/lib/event-emitter';
import { BUILT_IN_OPENERS } from '@/lib/citadel-apps/openers/built-in-openers';
import { FileOpenersContext, type FileOpeners } from '@/lib/citadel-apps/openers/file-openers-context';
import { deviceLastChoices } from '@/lib/citadel-apps/openers/last-choice';
import type { InstalledOpening } from '@/lib/citadel-apps/openers/open-installed';
import type { FileOpener } from '@/lib/citadel-apps/openers/openers';
import { pageOpenedFiles } from '@/lib/citadel-apps/runtime/page-opened-files';
import { topLevelTrees } from '@/components/layout/sidebar/tree-node-utils';

type Reader = typeof import('./read-installed-openers');
const reader = (): Promise<Reader> => import('./read-installed-openers');

export function FileOpenersProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state } = useWorkspace();
  const navigate: NavigateFunction = useNavigate();
  const [generation, setGeneration] = useState<number>(0);
  const [installed, setInstalled] = useState<readonly FileOpener[]>([]);
  // Installs are a signed-in member's: before sign-in, and for a page outside a workspace, none is asked for.
  const me: string | null = state.currentUser?.username ?? null;
  useEffect(() => eventEmitter.on('workspace:apps', (event: { answer: unknown } | undefined): void => {
    if (event === undefined) return;
    reader().then((r: Reader): void => { if (r.changesInstalls(event.answer)) setGeneration((g: number): number => g + 1); }, (error: unknown): void => {
      console.error('[apps] the installed apps that open files could not be loaded', error);
    });
  }), []);
  useEffect(() => {
    setInstalled([]);
    if (me === null) return undefined;
    let live: boolean = true;
    reader().then((r: Reader): Promise<FileOpener[]> => r.readInstalledOpeners()).then((openers: FileOpener[]): void => { if (live) setInstalled(openers); }, (error: unknown): void => {
      console.error('[apps] the installed apps that open files could not be read', error);
    });
    return (): void => { live = false; };
  }, [generation, me]);
  const fallbackNode: string | null = useMemo((): string | null => topLevelTrees(Object.values(state.nodes))[0]?.node.id ?? null, [state.nodes]);
  const available: readonly FileOpener[] = useMemo((): readonly FileOpener[] => [...BUILT_IN_OPENERS, ...installed], [installed]);
  const opening: InstalledOpening = useMemo((): InstalledOpening => ({ inbox: pageOpenedFiles, go: (path: string): void => { void navigate(path); }, fallbackNode }), [navigate, fallbackNode]);
  const value: FileOpeners = useMemo((): FileOpeners => ({ available, lastChoices: deviceLastChoices, installed: opening }), [available, opening]);
  return <FileOpenersContext.Provider value={value}>{children}</FileOpenersContext.Provider>;
}
