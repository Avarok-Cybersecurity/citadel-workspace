import { SCREENSHOT_ALERT_LIMITS } from '@/lib/p2p/screenshot-detection';
import { useState, useEffect } from 'react';
import { Eye, MessageSquare, Users } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { OnlineStatusRow, ProfileVisibilityRow, StrangerRequestsRow } from './PrivacyServerRows';
import { NotificationPreviewRow } from './NotificationPreviewRow';
import { AutoConnectRow } from './AutoConnectRow';
import { DiagnosticsPrivacySection } from './DiagnosticsPrivacySection';
import {
  getPrivacySettings,
  savePrivacySettings,
  type PrivacySettings,
} from '@/lib/privacy-settings';

/**
 * The settings themselves live in `@/lib/privacy-settings`, which is what the
 * send paths read. This tab used to own them outright — writing localStorage and
 * dispatching an event nothing listened to — so every switch here was inert.
 */


export function PrivacySettingsTab(): JSX.Element {
  const [settings, setSettings] = useState<PrivacySettings>(getPrivacySettings);

  useEffect(() => {
    savePrivacySettings(settings);
  }, [settings]);

  const update = <K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]): void => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5">
      {/* Visibility */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
          <Eye className="h-4 w-4 text-primary-accent" />
          Visibility
        </div>

        <OnlineStatusRow
          shows={settings.showOnlineStatus}
          onLocalChange={(v: boolean) => update('showOnlineStatus', v)}
        />

        <ProfileVisibilityRow />
      </div>

      {/* Messaging Privacy */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
          <MessageSquare className="h-4 w-4 text-primary-accent" />
          Messaging
        </div>

        <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-background/50">
          <div className="min-w-0">
            <Label htmlFor="typing-indicators" className="text-sm font-medium">Typing Indicators</Label>
            <p className="text-xs text-muted-foreground">Show when you're typing a message</p>
          </div>
          <Switch id="typing-indicators"
            checked={settings.showTypingIndicators}
            onCheckedChange={(v) => update('showTypingIndicators', v)}
          />
        </div>

        <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-background/50">
          <div className="min-w-0">
            <Label htmlFor="read-receipts" className="text-sm font-medium">Read Receipts</Label>
            <p className="text-xs text-muted-foreground">Let others know when you've read their messages</p>
          </div>
          <Switch id="read-receipts"
            checked={settings.sendReadReceipts}
            onCheckedChange={(v) => update('sendReadReceipts', v)}
          />
        </div>

        <NotificationPreviewRow />
      </div>

      {/* Access Control */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
          <Users className="h-4 w-4 text-primary-accent" />
          Access Control
        </div>

        <AutoConnectRow />

        <StrangerRequestsRow
          accepts={settings.acceptRequestsFromStrangers}
          onLocalChange={(v: boolean) => update('acceptRequestsFromStrangers', v)}
        />

        <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-background/50">
          <div className="min-w-0">
            <Label htmlFor="screenshot-alerts" className="text-sm font-medium">Screenshot Alerts</Label>
            <p className="text-xs text-muted-foreground">Get notified in a chat when the other person may have taken a screenshot.</p>
            <p className="text-xs text-warning-emphasis mt-1">{SCREENSHOT_ALERT_LIMITS}</p>
          </div>
          <Switch id="screenshot-alerts"
            checked={settings.notifyOnScreenshot}
            onCheckedChange={(v) => update('notifyOnScreenshot', v)}
          />
        </div>
      </div>

      <DiagnosticsPrivacySection />
    </div>
  );
}
