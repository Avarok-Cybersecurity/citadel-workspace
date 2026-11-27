/**
 * The app's picture stores, one per kind of document, each a PicturePort behind DocumentPictures
 * (loaded with the editor, never in the shell's bundle: picture-plan.ts).
 */
import { DocumentPictures, type PictureAccess } from './document-pictures';
import { sha256ContentId } from './content-id';
import { PICTURE_LIMITS } from './picture-config';
import type { PictureDocument, PicturePort } from './picture-port';
import { devicePictures } from './device-pictures';
import { workspaceServerPictures } from './server-pictures';
import WorkspaceService from '@/lib/workspace-service';
import { agentLocalDb } from '../chat/chat-app-ports';
import { sha256Hex } from '@/lib/chat/attachments/attachment-wire';
import { pairPicturePort } from './pair-pictures';
import { appPairPorts } from './app-pair-pictures';

function access(port: PicturePort, doc: PictureDocument): PictureAccess {
  return { kind: 'stored', pictures: new DocumentPictures({ port, doc, contentIdOf: sha256ContentId, now: (): number => Date.now(), limits: PICTURE_LIMITS }) };
}

/** A workspace page's, or a node chat document's: on the workspace server. */
export async function serverPictures(doc: Extract<PictureDocument, { kind: 'page' | 'nodeChat' }>): Promise<PictureAccess> {
  return access(workspaceServerPictures(WorkspaceService), doc);
}

/** A scratchpad document's: on this device, in the agent's LocalDB under the account. */
export async function scratchpadPictures(account: bigint, docId: string): Promise<PictureAccess> {
  return access(devicePictures(agentLocalDb, sha256Hex), { kind: 'scratchpad', account, docId });
}

/** A direct chat's document's: on each person's device, exchanged by content id over the pair's P2P channel. */
export async function pairPictures(selfCid: bigint, peerCid: bigint, docId: string): Promise<PictureAccess> {
  return access(pairPicturePort(appPairPorts(selfCid, peerCid)), { kind: 'pair', selfCid, peerCid, docId });
}
