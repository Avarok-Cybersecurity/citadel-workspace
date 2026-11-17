/**
 * Which file manager items open in Citadel Docs, and where their bytes come from.
 *
 * A RE-VFS file carries no Citadel App record (its metadata is name, size and MIME type), so it
 * is routed by extension and MIME type alone. Its bytes are read through WorkspaceFileReader:
 * the agent pulls it, then hands the bytes to the page (pulled-file-reader.ts).
 */
import { docsFileRoute, type DocsFileRoute } from '@/lib/citadel-apps/docs-file-kinds';
import { RevfsFileState, type RevfsNode } from '@/types/revfs-types';
import { readPulledFile, type PulledFileIO } from './pulled-file-reader';
import type { VFSItemActions } from './vfs-item-actions';

export function docsRouteOf(node: RevfsNode): DocsFileRoute {
  return docsFileRoute({ name: node.name, mime: node.fileMetadata?.fileType ?? '', app: null });
}

/**
 * Whether the item is a file Citadel Docs reads and the agent can pull (stored for you by a
 * peer or the server). A Received file is a local record and a Hosted one is a peer's
 * ciphertext; neither is pulled, so neither opens here.
 */
export function opensInDocs(node: RevfsNode): boolean {
  const pullable: boolean = node.fileState === RevfsFileState.Remote || node.fileState === RevfsFileState.ServerStored;
  return node.type === 'file' && pullable && docsRouteOf(node).kind === 'docs';
}

/**
 * The open-in-Docs action for this item, or null where it is not offered (a file Docs does not
 * read, or one that is not pulled). The menu, the inspector and the list's open action all ask
 * this, so they cannot disagree.
 */
export function docsOpenAction(actions: Pick<VFSItemActions, 'openInDocs'>, node: RevfsNode): (() => void) | null {
  return opensInDocs(node) ? (): void => actions.openInDocs(node) : null;
}

/** Where a stored file's bytes come from, for an app that opens them in the page. */
export interface WorkspaceFileReader {
  read(node: RevfsNode): Promise<Uint8Array>;
}

/** The product's reader: the agent pulls the file (DownloadFile), then hands its bytes over (ReadPulledFileChunk). */
export function agentFileReader(io: PulledFileIO): WorkspaceFileReader {
  return { read: (node: RevfsNode): Promise<Uint8Array> => readPulledFile(node, io) };
}
