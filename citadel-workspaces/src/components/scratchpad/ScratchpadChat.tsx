/**
 * The scratchpad: the shared chat pane over the account's conversation with itself, with its own
 * header. The same composer, formatting, edits, deletes, replies, documents and files as a direct
 * chat; none of a direct chat's peer machinery (connection route, supervisor, pause, call,
 * screenshot notice, chat interest), because those all address the peer, and there is none.
 */
import { useEffect, useMemo } from 'react';
import { ChatPane } from '@/components/chat/pane/ChatPane';
import { peerOpeningPorts } from '@/components/p2p/chat-document/use-chat-documents';
import { P2PMessengerManager } from '@/lib/p2p/p2p-messenger-manager';
import { createScratchpadTransport, scratchpadGate } from '@/lib/chat/transport/scratchpad-transport';
import { scratchpadBlobs } from '@/lib/scratchpad/scratchpad-blobs';
import { agentLocalDb } from '@/lib/cdoc/chat/chat-app-ports';
import { sha256Hex } from '@/lib/chat/attachments/attachment-wire';
import { readBrowserFile } from '@/lib/chat/transport/node-chat-io';
import { agentKeepsNotesToSelf } from '@/lib/agent-conversations/capabilities';
import { SCRATCHPAD_TITLE } from '@/lib/scratchpad/self-conversation';
import { errorLog } from '@/lib/debug-config';
import type { ChatSelf, ChatTransport } from '@/lib/chat/transport/chat-transport';
import type { GroupRestriction } from '@/components/chat/group-restriction';
import type { ValueStore } from '@/lib/value-store';
import { ScratchpadHeader } from './ScratchpadHeader';

interface ScratchpadChatProps {
  /** The account's own cid: the scratchpad is its conversation with itself. */
  cid: bigint;
  username: string;
  displayName: string;
}

export function ScratchpadChat({ cid, username, displayName }: ScratchpadChatProps): JSX.Element {
  const gate: ValueStore<GroupRestriction> = useMemo((): ValueStore<GroupRestriction> => scratchpadGate(cid), [cid]);
  useEffect((): (() => void) => {
    let live: boolean = true;
    agentKeepsNotesToSelf().then(
      (keeps: boolean): void => { if (live) gate.set(keeps ? 'allowed' : 'needs-agent-update'); },
      // Unanswered: every write is refused at the agent seam anyway (agent-actions.ts), so the gate is left as it is.
      (error: unknown): void => errorLog('ScratchpadChat', 'the agent did not say whether it keeps notes to self', error),
    );
    return (): void => { live = false; };
  }, [gate]);
  const transport: ChatTransport = useMemo((): ChatTransport => {
    const self: ChatSelf = { cid, username, displayName };
    return createScratchpadTransport({
      messenger: P2PMessengerManager.getInstance(),
      self,
      opening: peerOpeningPorts({ cid, name: SCRATCHPAD_TITLE, username }),
      blobs: scratchpadBlobs(cid, agentLocalDb, sha256Hex),
      readFile: readBrowserFile,
      sendGate: gate,
    });
  }, [cid, username, displayName, gate]);
  return <ScratchpadPane transport={transport} />;
}

const header = (): JSX.Element => <ScratchpadHeader />;

/** The scratchpad as it is shown, over any scratchpad transport (the polish harness renders this). */
export function ScratchpadPane({ transport }: { transport: ChatTransport }): JSX.Element {
  return <ChatPane transport={transport} pause={null} header={header} />;
}
