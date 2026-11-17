/**
 * The ports a DocumentSession takes in the app: this tab's workspace session, the browser's
 * clock, and the member roster for names and colours. The editor opener is the caller's (the
 * page view owns the worker). The local cache is this account's, in IndexedDB.
 */
import WorkspaceService from '@/lib/workspace-service';
import { rosterPeerName, rosterPeerUsername } from '@/lib/roster-peer-name';
import { usernameAvatarColor } from '@/lib/avatar-color';
import { hexColor, type HexColor } from '../editor/model-values';
import { workspaceDocumentsTransport } from './documents-transport';
import type { EditorOpener } from '../editor/controller';
import type { DocumentCache, DocumentSessionPorts, DocumentsTransport, PeerIdentity } from './ports';
import { indexedDbDocumentCache, placedCache } from './document-cache';
import { chatDocumentRecordId } from '@/lib/document-replica-cache';
import { browserInstanceLocks } from './instance-locks';
import { DOCUMENTS_RELAY_LIMITS } from './relay-limits';
import { RequestPacer, type DocumentPacing } from './request-pacer';
import { browserClock } from '@/lib/browser-clock';

export const rosterIdentity: PeerIdentity = (cid: bigint): { readonly name: string; readonly color: HexColor } => ({
  name: rosterPeerName(cid),
  color: hexColor(usernameAvatarColor(rosterPeerUsername(cid))),
});

/** A node's page (`chatDoc` null), or a document shared in its chat, kept on this device beside the page. */
export function workspaceCollabPorts(openEditor: EditorOpener, chatDoc: string | null): DocumentSessionPorts {
  const transport: DocumentsTransport = workspaceDocumentsTransport(WorkspaceService, chatDoc);
  const accountCache: DocumentCache = indexedDbDocumentCache(transport.selfCid, browserInstanceLocks());
  const cache: DocumentCache = chatDoc === null ? accountCache : placedCache(accountCache, (nodeId: string): string => chatDocumentRecordId(nodeId, chatDoc));
  return { transport, clock: browserClock, cache, openEditor, identify: rosterIdentity, pacing: tabPacing(transport.selfCid) };
}

const pacingByAccount: Map<bigint, DocumentPacing> = new Map<bigint, DocumentPacing>();

/** The kernel budgets per account, so every document this tab opens for one account shares these. */
function tabPacing(account: bigint): DocumentPacing {
  const known: DocumentPacing | undefined = pacingByAccount.get(account);
  if (known) return known;
  const made: DocumentPacing = { appends: new RequestPacer(browserClock, DOCUMENTS_RELAY_LIMITS.appendsPerSecond), pulls: new RequestPacer(browserClock, DOCUMENTS_RELAY_LIMITS.pullsPerSecond) };
  pacingByAccount.set(account, made);
  return made;
}

/** A `clientSeqBase` no other session instance will draw: a random 32-bit prefix. */
export function randomClientSeqBase(): bigint {
  const prefix: Uint32Array = crypto.getRandomValues(new Uint32Array(1));
  return BigInt(prefix[0]) << 32n;
}
