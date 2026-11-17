/**
 * The workspace view for a document node: decides what the person may do and hands the host
 * its props. Kept apart from DocumentHost so the host stays a pure contract for the editor.
 */
import { useMemo } from 'react';
import { useSelfName, type SelfName } from '@/hooks/use-self-name';
import type { ActionGate } from '@/hooks/use-permission-result';
import { useEditGate } from './use-edit-gate';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import type { NodeAppState } from '@/lib/citadel-apps/node-app-metadata';
import type { DocumentSource } from '@/lib/cdoc/document-source';
import { loadCdocRuntime } from '@/lib/cdoc/runtime-loader';
import { browserDocumentFiles } from '@/lib/document-files';
import { DocumentHost, UnreadableDocument } from './DocumentHost';
import { collaborationEditing } from './collab-replica';
import type { DocumentEditing } from './use-docs-document';

/** Until the document-content work item reads the node's stored document, every node opens blank. */
const BLANK_DOCUMENT: DocumentSource = { kind: 'blank' };

interface DocumentViewProps {
  node: DomainNode;
  app: Exclude<NodeAppState, { kind: 'none' }>;
}

export function DocumentView({ node, app }: DocumentViewProps): JSX.Element {
  // With the link down, the last answer this account had here (use-edit-gate.ts).
  const edit: ActionGate = useEditGate(node.id);
  const self: SelfName = useSelfName();
  // One keeper per node: a new identity would re-open the document.
  const editing: DocumentEditing = useMemo((): DocumentEditing => collaborationEditing(node.id), [node.id]);
  if (app.kind === 'unreadable') return <UnreadableDocument title={node.name} reason={app.reason} />;
  return (
    <DocumentHost
      nodeId={node.id}
      appId={app.app}
      title={node.name}
      permissions={{ edit }}
      documentSource={BLANK_DOCUMENT}
      loadCdocRuntime={loadCdocRuntime}
      commentAuthor={self.name ?? self.username ?? null}
      files={browserDocumentFiles}
      // A workspace document, not a file: there is no original to download.
      original={null}
      editing={editing}
    />
  );
}
