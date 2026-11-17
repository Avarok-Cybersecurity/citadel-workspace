import { useState, useEffect } from 'react';
import { describeFailure } from '@/lib/failure-message';
import { debugLog } from '@/lib/debug-config';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { serverAutoConnectService } from '@/lib/server-auto-connect-service';
import { p2pRegistrationService } from '@/lib/p2p-registration-service';
import { Loader2 } from 'lucide-react';
import { runAsyncSetup } from '@/lib/utils/async-utils';

export function ConnectionsSettingsTab(): JSX.Element {
  const { toast } = useToast();
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [autoAcceptRegistrations, setAutoAcceptRegistrations] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingAutoAccept, setSavingAutoAccept] = useState(false);

  useEffect(() => {
    runAsyncSetup(loadSettings);
  }, []);

  const loadSettings = async (): Promise<void> => {
    setLoading(true);
    try {
      const [enabled, autoAccept] = await Promise.all([
        serverAutoConnectService.getEnabled(),
        p2pRegistrationService.getAutoAcceptSetting(),
      ]);
      setAutoReconnect(enabled);
      setAutoAcceptRegistrations(autoAccept);
    } catch (error) {
      debugLog('ConnectionsSettingsTab', 'Failed to load connection settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (enabled: boolean): Promise<void> => {
    setAutoReconnect(enabled);
    setSaving(true);

    try {
      await serverAutoConnectService.setEnabled(enabled);
      toast({
        title: enabled ? 'Auto-reconnect enabled' : 'Auto-reconnect disabled',
        description: enabled
          ? 'Sessions will automatically reconnect when disconnected.'
          : 'This browser will not sign a lost session back in. Sign in again from the start page when you need it.',
      });
    } catch (error) {
      // Revert on error
      setAutoReconnect(!enabled);
      toast({
        title: 'Failed to save setting',
        // The reason, where there is one. A fixed sentence here leaves the user
        // unable to tell "storage is full" from "the write was refused" from
        // "the network blipped" -- and only one of those is worth retrying.
        description:
          error instanceof Error && error.message
            ? error.message
            : 'Could not update auto-reconnect preference.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAutoAcceptChange = async (checked: boolean): Promise<void> => {
    setAutoAcceptRegistrations(checked);
    setSavingAutoAccept(true);
    try {
      await p2pRegistrationService.setAutoAcceptSetting(checked);
      toast({
        title: 'Settings saved',
        description: `Auto-accept P2P registrations is now ${checked ? 'enabled' : 'disabled'}`,
      });
    } catch (error) {
      debugLog('ConnectionsSettingsTab', 'Failed to update auto-accept preference:', error);
      setAutoAcceptRegistrations(!checked);
      toast({
        title: 'Failed to save',
        description: describeFailure(error, 'Could not save your preference'),
        variant: 'destructive',
      });
    } finally {
      setSavingAutoAccept(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-background/50">
        <div className="space-y-0.5 flex-1 mr-4">
          <Label htmlFor="auto-reconnect" className="text-foreground font-medium cursor-pointer">
            Auto-reconnect
          </Label>
          <p className="text-xs text-muted-foreground">
            When a session to a workspace server is lost, this browser signs it back in on its own. Off: it does not try, and you sign in again from the start page.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Switch
            id="auto-reconnect"
            checked={autoReconnect}
            onCheckedChange={handleToggle}
            disabled={saving}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-background/50">
        <div className="space-y-0.5 flex-1 mr-4">
          <Label htmlFor="auto-accept-registrations" className="text-foreground font-medium cursor-pointer">
            Auto-accept P2P registrations
          </Label>
          <p className="text-xs text-muted-foreground">
            Automatically accept P2P registration requests from new users. Registered users are always accepted regardless of this setting.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savingAutoAccept && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Switch
            id="auto-accept-registrations"
            checked={autoAcceptRegistrations}
            onCheckedChange={handleAutoAcceptChange}
            disabled={savingAutoAccept}
          />
        </div>
      </div>
    </div>
  );
}

