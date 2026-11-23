/**
 * The scratchpad: an account's conversation with itself, and the one rule that marks it.
 *
 * It is a conversation like any other in the agent's store, under the account's own CID as the
 * peer (owner, 2026-11-23: "the same chat as if you were chatting with another ... a scratchpad
 * area for private thoughts, making documents, etc."). There is nobody at the other end, so
 * nothing in it is ever sent: no P2P message, no PeerRegister, no PeerConnect, no read receipt.
 * The agent refuses to send any of it (kernel/conversations `to_peer`, ILM `send`), and says so
 * in its greeting as `notes_to_self`; a window offers the scratchpad only to an agent that does.
 *
 * Stored on this device: the agent keeps it with the account's other conversations, in the same
 * records and under the same protection they have. It does not follow the account to its other
 * devices yet; syncing it across them is a follow-up, not a v1 promise.
 */

/** Whether the conversation with `peerCid` is the account's own scratchpad. */
export function isSelfConversation(ownCid: bigint | null | undefined, peerCid: bigint): boolean {
  return ownCid !== null && ownCid !== undefined && ownCid === peerCid;
}

/**
 * Refuses a P2P send or connection from the account to itself, before it reaches the agent. The
 * websocket service calls it on every road to a peer, so nothing can address the scratchpad's
 * nonexistent peer, whatever asks.
 */
export function refuseSelfSend(ownCid: bigint, peerCid: bigint, what: string): void {
  if (isSelfConversation(ownCid, peerCid)) throw new Error(`${what}: a conversation with yourself has no peer, so nothing is sent`);
}

export const SCRATCHPAD_TITLE: string = 'Scratchpad';

/** The header line and the empty transcript's sentence: whose it is, and who can see it. */
export const SCRATCHPAD_LINE: string = 'Your private scratchpad — notes, drafts and documents only you can see.';

/** Where it is kept, said beside the line: it matters, because it does not follow you yet. */
export const SCRATCHPAD_STORED: string = 'Stored on this device';

/** The composer's place when the agent cannot keep notes unsent. */
export const SCRATCHPAD_NEEDS_AGENT: string =
  'Your scratchpad needs a newer Citadel agent. Update the agent on this device to write notes here.';

/** Said above an open document made in the scratchpad. */
export const SCRATCHPAD_DOCUMENTS: string = 'Only you can see this document';

/** Said beside the attach control. */
export const SCRATCHPAD_FILES: string = 'Kept on this device, in your scratchpad. Only you can open it.';

/** Thrown before anything is asked of an agent that would send a note to the account's own CID. */
export class NotesNeedAgentUpdate extends Error {
  constructor() {
    super(SCRATCHPAD_NEEDS_AGENT);
    this.name = 'NotesNeedAgentUpdate';
  }
}
