/**
 * Which app opens a file manager item, and what activating one does. The menu, the inspector and
 * the list's open action all ask `actions.openersOf`, so they cannot disagree.
 *
 * Only a file whose bytes the agent can pull (stored for you by a peer or the server) can be
 * handed to an app: a Received file is a local record and a Hosted one is a peer's ciphertext.
 */
import { RevfsFileState, type RevfsNode } from '@/types/revfs-types';
import { activationOf, openersFor, type FileActivation, type FileOpener, type Openers } from '@/lib/citadel-apps/openers/openers';
import type { VFSItemActions } from './vfs-item-actions';

/** The apps in `available` that open the item, `lastChoice` first, or null when no app could read its bytes here. */
export function openersOfNode(node: RevfsNode, available: readonly FileOpener[], lastChoice: string | null): Openers | null {
  const pullable: boolean = node.fileState === RevfsFileState.Remote || node.fileState === RevfsFileState.ServerStored;
  if (node.type !== 'file' || !pullable) return null;
  return openersFor(node.name, available, lastChoice);
}

type Activating = Pick<VFSItemActions, 'openersOf' | 'openIn' | 'download'>;

/**
 * A file's open action: in the app that opens it, else downloaded. When no app opens a file whose
 * bytes could have been read, the person is told why it downloaded instead of opening.
 */
export function activateFile(node: RevfsNode, actions: Activating, notify: (notice: string) => void): void {
  const activation: FileActivation = activationOf(actions.openersOf(node));
  if (activation.kind === 'open') { actions.openIn(activation.app, node); return; }
  if (activation.notice !== null) notify(activation.notice);
  actions.download(node);
}
