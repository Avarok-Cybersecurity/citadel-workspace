/**
 * A chat's document tab: the Citadel Docs canvas, kept live with the chat's peer or channel, under
 * a strip saying who it is shared with (and its rename, where one is carried), with a moved document's loss banner above it;
 * or, when the document does not open as a canvas, the notice that says why.
 */
import { useState, useSyncExternalStore } from 'react';
import { Pencil, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppLoadingPane } from '@/components/app-loading/AppLoadingPane';
import { DocumentHost, type DocumentPermissions } from '@/components/documents/DocumentHost';
import { LossReportBanner } from '@/components/documents/migration/LossReportBanner';
import type { DocumentSource } from '@/lib/cdoc/document-source';
import { loadCdocRuntime } from '@/lib/cdoc/runtime-loader';
import { browserDocumentFiles } from '@/lib/document-files';
import type { LoadStage } from '@/lib/app-loading/load-stage';
import type { ValueStore } from '@/lib/value-store';
import { RenameDocumentDialog } from '../RenameDocumentDialog';
import type { ChatDocumentOpening, MovedBanner } from './chat-document-opening';
import { UnmovedDocument } from './UnmovedDocument';

const OPENING: LoadStage = { kind: 'app' };
/** The replica is what opens (chat-replica.ts); the source is only what a replica-less view would show. */
const KEPT_REPLICA: DocumentSource = { kind: 'blank' };
const MAY_EDIT: DocumentPermissions = { edit: { enabled: true, reason: null } };

interface ChatDocumentPaneProps {
  readonly docId: string;
  /** The title the chat message gave it, until the document's own is known. */
  readonly title: string;
  readonly peerName: string;
  /** Who it is kept live with, as the strip above it says it (the transport's `sharedWith`). */
  readonly sharedWith: string;
  readonly selfName: string;
  /** Null while it is being opened (or moved). */
  readonly opening: ChatDocumentOpening | null;
  readonly onRetry: () => void;
  readonly onRename: (title: string) => Promise<void>;
}

const subscribeNone = (): (() => void) => (): void => undefined;
const nothing = (): null => null;

function useStore<T>(store: ValueStore<T> | null): T | null {
  return useSyncExternalStore(store === null ? subscribeNone : store.subscribe, store === null ? nothing : store.get);
}

export function ChatDocumentPane({ docId, title, peerName, sharedWith, selfName, opening, onRetry, onRename }: ChatDocumentPaneProps): JSX.Element {
  const [renaming, setRenaming] = useState<boolean>(false);
  const canvas: Extract<ChatDocumentOpening, { kind: 'canvas' }> | null = opening?.kind === 'canvas' ? opening : null;
  const shownTitle: string = useStore(canvas?.document.title ?? null) ?? title;
  const banner: MovedBanner | null = useStore(canvas?.moved?.banner ?? null);
  if (opening === null) return <AppLoadingPane appName="Citadel Docs" stage={OPENING} />;
  if (opening.kind === 'unmoved') {
    return <UnmovedDocument docId={docId} title={title} peerName={peerName} reason={opening.reason} loadOriginal={opening.loadOriginal} onRetry={onRetry} />;
  }
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background" data-testid="chat-document-pane" data-document-id={docId}>
      <div className="flex min-h-[44px] min-w-0 items-center gap-[8px] border-b border-border px-[16px] text-xs text-muted-foreground">
        <Users className="h-[16px] w-[16px] shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{sharedWith}</span>
        {opening.document.rename !== null && <Button
          variant="ghost" size="sm" className="min-h-[44px] shrink-0 gap-[4px] text-muted-foreground hover:text-foreground"
          onClick={(): void => setRenaming(true)} data-testid="live-doc-rename"
        >
          <Pencil className="h-[14px] w-[14px]" aria-hidden="true" />
          Rename
        </Button>}
      </div>
      {opening.moved !== null && banner !== null && (
        <LossReportBanner
          docId={docId} report={banner.report} conflict={banner.conflict} loadOriginal={opening.moved.loadOriginal}
          files={browserDocumentFiles} loadCdocRuntime={loadCdocRuntime}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <DocumentHost
          nodeId={docId} appId="docs" title={shownTitle} permissions={MAY_EDIT} documentSource={KEPT_REPLICA}
          loadCdocRuntime={loadCdocRuntime} commentAuthor={selfName} files={browserDocumentFiles} original={null}
          editing={opening.document.editing}
        />
      </div>
      <RenameDocumentDialog open={renaming} currentTitle={shownTitle} onRename={onRename} onClose={(): void => setRenaming(false)} />
    </div>
  );
}
