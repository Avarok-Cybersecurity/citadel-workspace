/**
 * The facts about a peer connection, as shown in chat settings.
 *
 * Extracted from ChatSettingsPanel, which is one of the files held at its
 * current length by check-file-length's ratchet — an exemption is a ceiling,
 * so adding to it means taking something out.
 *
 * "Connection Type: P2P Encrypted" used to sit here, a constant rendered under
 * a label that reads as live status. It says the same thing whether the peer is
 * connected, offline, or queueing through ILM. It is now labelled as the
 * property of the channel that it is.
 */

import { formatBytes } from '@/lib/format-bytes';
import type { ConversationFacts } from './connection-facts';
import { formatDay } from '@/lib/format-time';

interface ConnectionFactsProps extends ConversationFacts {
  peerCid: string;
}

/** A row is shown only when the conversation's records can back it; see connection-facts. */
export function ConnectionFacts({ peerCid, firstContact, transferredBytes }: ConnectionFactsProps): JSX.Element {
  return (
    <>
  <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-surface/50">
    <span className="text-sm text-muted-foreground">Peer CID</span>
    <span className="text-sm text-foreground/80 font-mono">{peerCid.slice(0, 16)}...</span>
  </div>
  <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-surface/50">
    {/* "Connection Type" read as live status while being a
        constant. Relabelled to what it actually states: a
        property of the channel, true whether or not the peer is
        reachable right now. */}
    <span className="text-sm text-muted-foreground">Encryption</span>
    <span className="text-sm text-foreground/80">End-to-end</span>
  </div>
  {firstContact !== null && (
    <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-surface/50" data-testid="fact-first-contact">
      <span className="text-sm text-muted-foreground">First Contact</span>
      <span className="text-sm text-foreground/80">{formatDay(firstContact)}</span>
    </div>
  )}
  {transferredBytes !== null && (
    <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-surface/50" data-testid="fact-transferred">
      <span className="text-sm text-muted-foreground">Files Transferred (size)</span>
      <span className="text-sm text-foreground/80">{formatBytes(transferredBytes)}</span>
    </div>
  )}
    </>
  );
}
