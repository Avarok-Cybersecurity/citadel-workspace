/**
 * What to tell the user about a sync that did not bring the peer's list back.
 *
 * "The peer did not answer — your changes were sent, try again in a moment"
 * was said for both failures, and was wrong about one: a request that never
 * left was not answered because nobody received it, and "try again in a
 * moment" sent the user to wait on it. Nor did it say what an answer needs:
 * the peer's side is answered by their browser, not their agent, so it comes
 * only while they are signed in with the app open.
 */
import type { SyncOutcome } from '@/lib/revfs/revfs-service';

export interface SyncNotice {
  title: string;
  description: string;
}

/** Null when the peer's list arrived and there is nothing to warn about. */
export function syncNotice(outcome: SyncOutcome, peer: string): SyncNotice | null {
  switch (outcome.kind) {
    case 'answered':
      return null;
    case 'unsent':
      return {
        title: `Could not reach ${peer}`,
        description: `The request was not sent: there is no open P2P connection to ${peer}. Open a chat with them to connect, then sync again. Your saved list here is unchanged.`,
      };
    case 'unanswered':
      return {
        title: `${peer} did not answer`,
        description: `The request was sent and no file list came back within ${Math.round(outcome.waitedMs / 1000)} s. ${peer}'s side answers only while they are signed in with Citadel open. Your saved list here is unchanged.`,
      };
  }
}
