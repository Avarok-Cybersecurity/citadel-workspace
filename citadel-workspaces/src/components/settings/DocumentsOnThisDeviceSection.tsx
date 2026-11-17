/**
 * Settings -> Security -> Documents on this device: the account's "Encrypt on this device"
 * setting, the same switch and words as the document title bar's (AtRestSwitch).
 */
import { HardDrive } from 'lucide-react';
import { AtRestSwitch } from '@/components/documents/save/AtRestSwitch';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import type { TabIdentity } from '@/lib/tab-identity';

export function DocumentsOnThisDeviceSection(): JSX.Element | null {
  const me: TabIdentity | null = useTabIdentity();
  if (me === null || me.cid === undefined) return null;
  return (
    <section className="space-y-3" data-testid="settings-documents-on-this-device">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
        <HardDrive className="h-4 w-4 text-primary-accent" aria-hidden="true" />Documents on this device
      </div>
      <AtRestSwitch account={me.cid} place="settings" />
    </section>
  );
}
