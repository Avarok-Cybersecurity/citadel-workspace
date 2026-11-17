/**
 * The one way replicas are opened (EditorOpener). Every call mints a new CRDT client id from
 * the random source it was built with: 64 random bits, so two replicas of one document (two
 * tabs of one account are two) never share one without any coordination. Never a default,
 * never the account's CID.
 */
import type { EditorOrigin } from './controller';
import { EditorSession, type EditorSessionDeps } from './editor-session';

/** Fills `bytes` with cryptographically random values (crypto.getRandomValues in the app). */
export type RandomBytes = (bytes: Uint8Array) => Uint8Array;

export function newReplicaId(random: RandomBytes): bigint {
  const bytes: Uint8Array = random(new Uint8Array(8));
  if (bytes.length !== 8) throw new Error('the random source did not fill 8 bytes');
  let id: bigint = 0n;
  for (const b of bytes) id = (id << 8n) | BigInt(b);
  return id;
}

/** An EditorOpener over one runtime; it returns the session, which the page view also needs. */
export function createEditorOpener(deps: EditorSessionDeps, random: RandomBytes): (from: EditorOrigin) => Promise<EditorSession> {
  return (from: EditorOrigin): Promise<EditorSession> => EditorSession.open(deps, newReplicaId(random), from);
}
