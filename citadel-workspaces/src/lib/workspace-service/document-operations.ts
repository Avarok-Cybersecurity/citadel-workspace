/**
 * Workspace Service - Document Operations
 *
 * A document is a tree node whose metadata names the Citadel App it opens in. Creating one is
 * an ordinary CreateNode with that metadata; every argument is explicit, because a missing app
 * or level would otherwise become somebody's guess (see lib/citadel-apps/registry).
 */
import { citadelApp, creatableIn, type CitadelApp, type CitadelAppId } from '@/lib/citadel-apps/registry';
import { encodeNodeApp } from '@/lib/citadel-apps/node-app-metadata';
import { createNode } from './node-operations';
import type { ProtocolSender } from './workspace-operations';

export interface NewDocument {
  parentId: string;
  /** The entity type the live schema permits under the parent; see document-placement. */
  childType: string;
  name: string;
  app: CitadelAppId;
}

/** Create the document node; resolves when the server has accepted it. */
export async function createDocument(sender: ProtocolSender, document: NewDocument): Promise<void> {
  const app: CitadelApp = citadelApp(document.app);
  if (!creatableIn(app, 'workspaceTree')) throw new Error(`${app.name} is not available yet.`);
  const name: string = document.name.trim();
  if (name === '') throw new Error('A document needs a name.');
  return createNode(sender, document.parentId, { Child: document.childType }, name, '', {
    metadata: encodeNodeApp(null, document.app),
  });
}
