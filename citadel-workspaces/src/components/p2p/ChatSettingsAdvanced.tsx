/**
 * The Advanced tab. Message retention and the encryption level are enforced
 * (useChatAdvancedSettings; lib/p2p/retention-sweep, lib/p2p/chat-level-change).
 *
 * All three were uncontrolled -- `defaultValue`, no `onChange`, no store -- and
 * then disabled with a "not enforced" note. The note now sits only where it is
 * still true:
 *
 * - Encryption level: the channel opens at the chat's level, offers below it
 *   are declined, and messages carry it. It was disabled while a P2P level
 *   above the login's ended the whole server session; Citadel-Protocol
 *   539e416d protects peer signals at the carrying session's level instead
 *   (citadel-internal-service/tests/peer_security_level.rs). One property is
 *   still open there: the SDK does not refuse a message above its channel's
 *   level, which this control never sends, since the channel is opened at it.
 * - Connection priority is not offered. The agent's relay policy (TurnPolicy)
 *   must match on both peers and the offer does not carry it: a relay-only
 *   choice made by one person times out the connection (pinned ignored in
 *   citadel-internal-service/tests/peer_turn.rs, 4c). A disabled control with a
 *   "not enforced" note was the other option; offering nothing is the honest one.
 */
import { Sliders, MessageSquare } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  CHAT_SECURITY_LEVELS,
  RETENTION_CHOICES,
  type ChatSecurityLevel,
  type Retention,
} from '@/lib/p2p/chat-advanced-settings';
import { useChatAdvancedSettings, type ChatAdvancedControls } from './useChatAdvancedSettings';

const SELECT_CLASS: string = 'bg-surface border border-surface rounded px-2 py-1 text-sm text-foreground/80';

function retentionLabel(r: Retention): string {
  if (r === 'forever') return 'Keep everything';
  if (r === 1) return '1 day';
  if (r === 365) return '1 year';
  return `${r} days`;
}

interface ChatSettingsAdvancedProps {
  isOpen: boolean;
  peerCid: bigint;
  peerName: string;
}

export function ChatSettingsAdvanced({ isOpen, peerCid, peerName }: ChatSettingsAdvancedProps): JSX.Element {
  const { settings, status, error, changeRetention, changeSecurityLevel }: ChatAdvancedControls = useChatAdvancedSettings(isOpen, peerCid);
  return (
    <>
        <div className="flex items-center justify-between gap-3 p-4 rounded-lg bg-surface/50">
          <div className="flex items-center gap-3">
            <Sliders className="h-5 w-5 text-warning-emphasis shrink-0" />
            <div>
              <Label htmlFor="encryption-level" className="text-sm font-medium">Encryption Level</Label>
              <p className="text-xs text-muted-foreground">
                The direct connection and your messages in this chat are encrypted at this level.
                Higher levels add layers and cost more work per message; {peerName}'s own setting
                decides what they send. Changing it reconnects the chat.
              </p>
            </div>
          </div>
          <select id="encryption-level" className={SELECT_CLASS}
            value={settings === null ? '' : settings.securityLevel}
            disabled={settings === null}
            onChange={(e): void => {
              const chosen: ChatSecurityLevel | undefined = CHAT_SECURITY_LEVELS.find((l: ChatSecurityLevel): boolean => l === e.target.value);
              if (chosen !== undefined) void changeSecurityLevel(chosen);
            }}
          >
            {settings === null && <option value="">Loading…</option>}
            {CHAT_SECURITY_LEVELS.map((l: ChatSecurityLevel) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        <div className="flex items-center justify-between gap-3 p-4 rounded-lg bg-surface/50">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-5 w-5 text-success-emphasis shrink-0" />
            <div>
              <Label htmlFor="message-retention" className="text-sm font-medium">Message Retention</Label>
              <p className="text-xs text-muted-foreground">
                Messages older than this are deleted from this device when you open the chat
                and every hour. {peerName}'s copy is not affected.
              </p>
            </div>
          </div>
          <select id="message-retention" className={SELECT_CLASS}
            value={settings === null ? '' : String(settings.retention)}
            disabled={settings === null}
            onChange={(e): void => {
              const chosen: Retention | undefined = RETENTION_CHOICES.find((r: Retention): boolean => String(r) === e.target.value);
              if (chosen !== undefined) void changeRetention(chosen);
            }}
          >
            {settings === null && <option value="">Loading…</option>}
            {RETENTION_CHOICES.map((r: Retention) => <option key={String(r)} value={String(r)}>{retentionLabel(r)}</option>)}
          </select>
        </div>

        {status && <p className="text-xs text-muted-foreground px-1" role="status">{status}</p>}
        {error && <p className="text-xs text-destructive px-1" role="alert">{error}</p>}
    </>
  );
}
