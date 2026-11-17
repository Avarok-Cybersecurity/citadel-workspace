/**
 * Whether this account's notifications show the message text, or only who
 * wrote it. Per account, kept by the agent (agent 0.8.6 raises the system's
 * notifications itself), and off until the user turns it on: a lock screen
 * should not read your messages out to the room.
 *
 * Shown only when the agent hosts the account; an older agent raises none.
 */
import { useEffect, useState } from 'react';
import type { AccountPreferences } from 'citadel-internal-service-wasm-client';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { agentHostsConversations } from '@/lib/agent-conversations/capabilities';
import { agentConversations } from '@/lib/agent-conversations/requests';
import { pushAccountPreferences } from '@/lib/agent-conversations/push-preferences';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { p2pMessengerManager } from '@/lib/p2p/p2p-messenger-manager';
import { describeFailure } from '@/lib/failure-message';

const peers = (): bigint[] => p2pMessengerManager.getAllConversations().map((c) => c.peerCid);

export function NotificationPreviewRow(): JSX.Element | null {
  const [account, setAccount] = useState<bigint | null>(null);
  const [shows, setShows] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live: boolean = true;
    void (async (): Promise<void> => {
      const cid: bigint | null = await getCurrentCid();
      if (cid === null || !(await agentHostsConversations())) return;
      const prefs: AccountPreferences = await agentConversations.getPreferences(cid);
      if (live) { setAccount(cid); setShows(prefs.notification_preview === 'Text'); }
    })().catch((e: unknown) => { if (live) setError(describeFailure(e, 'The notification setting could not be read.')); });
    return (): void => { live = false; };
  }, []);

  if (account === null && error === null) return null;

  const change = (on: boolean): void => {
    if (account === null) return;
    setShows(on);
    setError(null);
    pushAccountPreferences(account, peers, on ? 'Text' : 'SenderOnly').catch((e: unknown) => {
      setShows(!on);
      setError(describeFailure(e, 'The notification setting was not saved.'));
    });
  };

  return (
    <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-background/50">
      <div className="min-w-0">
        <Label htmlFor="notification-preview" className="text-sm font-medium">Message Text in Notifications</Label>
        <p className="text-xs text-muted-foreground">Off: a notification says who wrote, not what. For this account only.</p>
        {error && <p role="alert" className="text-xs text-destructive mt-1">{error}</p>}
      </div>
      <Switch id="notification-preview" data-testid="notification-preview-switch" checked={shows} disabled={account === null} onCheckedChange={change} />
    </div>
  );
}
