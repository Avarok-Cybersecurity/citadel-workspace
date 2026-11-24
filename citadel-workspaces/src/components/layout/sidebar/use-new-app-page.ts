/**
 * The sidebar's "New app page": which parent the dialog is open for, what the live schema permits
 * there, which installs may be its page (read when the dialog opens), and the write. The dialog
 * itself does no I/O; this hands it `create` and the candidates.
 */
import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/hooks/use-toast';
import { toastSuccess } from '@/lib/toast-helpers';
import WorkspaceService from '@/lib/workspace-service';
import { sessionAppsTransport } from '@/lib/citadel-apps/apps-api';
import { openAppsModal } from '@/lib/citadel-apps/apps-modal-store';
import { loadPageCandidates, type CandidateSource, type PageCandidates } from '@/lib/citadel-apps/page-candidates';
import { childTypesUnder, documentPlacement } from '@/components/documents/document-placement';
import type { NewAppPageInput } from '@/components/documents/NewAppPageDialog';
import { zoneDataFrom } from '@/components/office/app-zone/zone-data';
import type { NewDocumentTarget } from './use-new-document';
import { ancestorIdsOf } from './tree-node-utils';

export interface NewAppPageFlow {
  target: NewDocumentTarget | null;
  candidates: PageCandidates;
  open: (parentId: string) => void;
  close: () => void;
  create: (input: NewAppPageInput) => Promise<void>;
  openApps: () => void;
}

/** The production source: this tab's apps session, read afresh each time the dialog opens. */
export const sessionCandidates = (): CandidateSource => zoneDataFrom(sessionAppsTransport);

/** `onCreated` is told the parent once the server has accepted the page under it; `source` reads installs and listings. */
export function useNewAppPage(onCreated: (parentId: string) => void, source: () => CandidateSource): NewAppPageFlow {
  const { state } = useWorkspace();
  const { toast } = useToast();
  const [target, setTarget] = useState<NewDocumentTarget | null>(null);
  const [candidates, setCandidates] = useState<PageCandidates>({ kind: 'loading' });
  const asked: MutableRefObject<number> = useRef<number>(0);

  const open: (parentId: string) => void = useCallback((parentId: string): void => {
    const parentName: string = state.nodes[parentId]?.name ?? (state.workspace?.name || 'Workspace');
    setTarget({ parentId, parentName, placement: documentPlacement(childTypesUnder(parentId, state.nodes, state.treeSchema), parentName) });
    setCandidates({ kind: 'loading' });
    const ask: number = ++asked.current;
    const answered: (found: PageCandidates) => void = (found: PageCandidates): void => { if (ask === asked.current) setCandidates(found); };
    loadPageCandidates(source(), parentId, ancestorIdsOf(state.nodes, parentId)).then(answered, (failure: unknown): void => {
      answered({ kind: 'failed', why: failure instanceof Error ? failure.message : 'The installed apps could not be read.' });
    });
  }, [state.nodes, state.treeSchema, state.workspace?.name, source]);

  const close: () => void = useCallback((): void => { asked.current += 1; setTarget(null); }, []);

  const create: (input: NewAppPageInput) => Promise<void> = useCallback(async ({ candidate, childType, name }: NewAppPageInput): Promise<void> => {
    if (!target) throw new Error('No parent was chosen for the page.');
    await WorkspaceService.createAppPage({ parentId: target.parentId, childType, name, page: { app: candidate.app.manifest.id, installId: candidate.install.id } });
    toastSuccess(toast, 'Page created', `${name} shows ${candidate.app.manifest.name}`);
    onCreated(target.parentId);
  }, [target, toast, onCreated]);

  const openApps: () => void = useCallback((): void => { close(); openAppsModal({ kind: 'browse' }); }, [close]);

  return { target, candidates, open, close, create, openApps };
}
