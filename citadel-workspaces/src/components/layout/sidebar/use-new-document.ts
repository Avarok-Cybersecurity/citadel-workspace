/**
 * The sidebar's "New document": which parent the dialog is open for, what the live schema
 * permits there, and the write. The dialog itself does no I/O; this hands it `create`.
 */
import { useCallback, useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/hooks/use-toast';
import { toastSuccess } from '@/lib/toast-helpers';
import WorkspaceService from '@/lib/workspace-service';
import { citadelApp } from '@/lib/citadel-apps/registry';
import { childTypesUnder, documentPlacement, type DocumentPlacement } from '@/components/documents/document-placement';
import type { NewDocumentInput } from '@/components/documents/NewDocumentDialog';

export interface NewDocumentTarget {
  parentId: string;
  parentName: string;
  placement: DocumentPlacement;
}

export interface NewDocumentFlow {
  target: NewDocumentTarget | null;
  open: (parentId: string) => void;
  close: () => void;
  create: (input: NewDocumentInput) => Promise<void>;
}

/** `onCreated` is told the parent once the server has accepted the document under it. */
export function useNewDocument(onCreated: (parentId: string) => void): NewDocumentFlow {
  const { state } = useWorkspace();
  const { toast } = useToast();
  const [target, setTarget] = useState<NewDocumentTarget | null>(null);

  const open: (parentId: string) => void = useCallback((parentId: string): void => {
    const parentName: string = state.nodes[parentId]?.name ?? (state.workspace?.name || 'Workspace');
    const placement: DocumentPlacement = documentPlacement(childTypesUnder(parentId, state.nodes, state.treeSchema), parentName);
    setTarget({ parentId, parentName, placement });
  }, [state.nodes, state.treeSchema, state.workspace?.name]);

  const close: () => void = useCallback((): void => setTarget(null), []);

  const create: (input: NewDocumentInput) => Promise<void> = useCallback(async (input: NewDocumentInput): Promise<void> => {
    if (!target) throw new Error('No parent was chosen for the document.');
    await WorkspaceService.createDocument({ parentId: target.parentId, ...input });
    toastSuccess(toast, 'Document created', `${input.name} opens in ${citadelApp(input.app).name}`);
    onCreated(target.parentId);
  }, [target, toast, onCreated]);

  return { target, open, close, create };
}
