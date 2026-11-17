/**
 * What sits above a node channel's messages, where a direct chat has its peer's header: who the
 * channel reaches ("12 members, 3 online"), who is typing, and the channel's rules.
 *
 * The counts are the node's roster, the list receipts are counted against, so "Seen by 2 of 11"
 * and "12 members" cannot disagree. Nothing is shown for a roster not yet known: a guessed count
 * is the defect the receipts were rebuilt to remove.
 */
import type { RosterEntry } from '@/lib/chat/transport/read-receipts';

interface NodeChatHeaderProps {
  /** Null while the channel's members are not known. */
  roster: readonly RosterEntry[] | null;
  typing: readonly string[];
  /** The channel's rules; null when it has none. */
  rules: string | null;
}

export function typingSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.length} people are typing…`;
}

export function rosterSummary(roster: readonly RosterEntry[]): string {
  const online: number = roster.filter((entry: RosterEntry): boolean => entry.online === true).length;
  return `${roster.length} member${roster.length === 1 ? '' : 's'}, ${online} online`;
}

export function NodeChatHeader({ roster, typing, rules }: NodeChatHeaderProps): JSX.Element {
  const typed: string | null = typingSentence(typing);
  return (
    <div className="border-b border-border" data-testid="node-chat-header">
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        {roster !== null && <span className="text-muted-foreground" data-testid="node-chat-roster">{rosterSummary(roster)}</span>}
        {/* Always mounted, so a screen reader hears each change rather than only the first. */}
        <span className="min-w-0 truncate text-primary-accent motion-safe:animate-pulse" aria-live="polite" data-testid="node-chat-typing">{typed ?? ''}</span>
      </div>
      {rules !== null && (
        <div className="px-4 py-2 bg-primary/20 border-t border-primary/40" data-testid="channel-rules">
          <p className="text-sm text-primary-accent">{rules}</p>
        </div>
      )}
    </div>
  );
}
