import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Info, Shield } from 'lucide-react';
import { REVFS_DEFAULT_QUOTA_BYTES } from '@/types/messaging-layer';
import { HelpHint } from '@/components/shared/HelpHint';
import type { FileTransferSettings } from '@/lib/file-transfer';

interface ChatSettingsRemoteTabProps {
  peerName: string;
  settings: FileTransferSettings;
  revfsQuotaMb: number;
  defaultMaxMb: number;
  formatSizeLimit: (bytes: number) => string;
  onAllowRevfsChange: (allowed: boolean) => Promise<void>;
  onRevfsQuotaChange: (values: number[]) => Promise<void>;
}

export function ChatSettingsRemoteTab({
  peerName, settings, revfsQuotaMb, defaultMaxMb, formatSizeLimit,
  onAllowRevfsChange, onRevfsQuotaChange,
}: ChatSettingsRemoteTabProps): JSX.Element {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-surface/50">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <Label htmlFor="allow-revfs" className="text-sm font-medium">
              Allow {peerName} to store files on your device
            </Label>
            <HelpHint topic="storing files for this peer">
              <strong>Post-Quantum Secure:</strong> When you allow storage, you become a
              blind host. Files are encrypted with post-quantum algorithms — you cannot
              view or decrypt their contents. Only the file owner has the keys.
            </HelpHint>
          </div>
          <p className="text-xs text-muted-foreground">Provide encrypted storage space for this peer</p>
        </div>
        <Switch
          id="allow-revfs"
          checked={settings.allowRevfsStorage}
          onCheckedChange={onAllowRevfsChange}
          data-testid="allow-revfs-switch"
        />
      </div>

      <div className={`space-y-3 p-4 rounded-lg bg-surface/50 ${!settings.allowRevfsStorage ? 'opacity-50' : ''}`}>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="storage-quota-for-peername" className="text-sm font-medium">Storage quota for {peerName}</Label>
          <span className="text-sm text-primary-accent font-medium" data-testid="revfs-quota-value">{revfsQuotaMb} MB</span>
        </div>
        <Slider id="storage-quota-for-peername"
          label="Storage quota for this peer"
          value={[revfsQuotaMb]} onValueChange={onRevfsQuotaChange}
          max={defaultMaxMb} min={1} step={1} className="w-full"
          disabled={!settings.allowRevfsStorage} data-testid="revfs-quota-slider"
        />
        <p className="text-xs text-muted-foreground">Server default: {formatSizeLimit(REVFS_DEFAULT_QUOTA_BYTES)}</p>
      </div>

      <div className="p-4 rounded-lg bg-gradient-to-r from-success/10 to-success/5 border border-success/20">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-success-emphasis mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-medium text-success-emphasis mb-1">Zero-Knowledge Storage</h4>
            <p className="text-xs text-foreground/80">
              RE-VFS uses post-quantum cryptography to ensure complete privacy.
              As a storage host, you provide blind storage — you cannot view, read,
              or decrypt the stored files. Only the file owner holds the decryption keys.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-primary-accent/10 border border-primary-accent/20">
        <Info className="h-4 w-4 text-primary-accent mt-0.5 flex-shrink-0" />
        <p className="text-xs text-foreground/80">
          Files persist until manually deleted via File Manager (Right-click → Delete).
        </p>
      </div>

    </div>
  );
}
