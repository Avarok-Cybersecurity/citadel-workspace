import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Upload, HardDrive } from 'lucide-react';
import { FILE_TRANSFER_DEFAULT_MAX_SIZE_BYTES } from '@/types/messaging-layer';
import { STAGED_UPLOAD_CEILING_BYTES } from '@/lib/file-transfer/staged-upload/chunk-plan';

/**
 * What this account will accept: past the 2 GB a browser can send, because Browse
 * Files sends from disk with no ceiling -- a slider that stopped at 2 GB made the
 * advice for a 3 GB file a dead end (UX review, finding 2).
 */
const ACCEPT_LIMIT_MAX_MB: number = 10 * 1024;
import type { FileTransferSettings } from '@/lib/file-transfer';
import { ChatSettingsRemoteTab } from './ChatSettingsRemoteTab';

interface ChatSettingsFileTabProps {
  peerName: string;
  activeFileTab: string;
  setActiveFileTab: (tab: string) => void;
  settings: FileTransferSettings;
  maxFileSizeMb: number;
  revfsQuotaMb: number;
  defaultMaxMb: number;
  formatSizeLimit: (bytes: number) => string;
  onAutoAcceptChange: (enabled: boolean) => Promise<void>;
  onMaxFileSizeChange: (values: number[]) => Promise<void>;
  onAllowRevfsChange: (allowed: boolean) => Promise<void>;
  onRevfsQuotaChange: (values: number[]) => Promise<void>;
}

export function ChatSettingsFileTab({
  peerName, activeFileTab, setActiveFileTab, settings,
  maxFileSizeMb, revfsQuotaMb, defaultMaxMb, formatSizeLimit,
  onAutoAcceptChange, onMaxFileSizeChange,
  onAllowRevfsChange, onRevfsQuotaChange,
}: ChatSettingsFileTabProps): JSX.Element {
  return (
    <Tabs value={activeFileTab} onValueChange={setActiveFileTab} className="w-full">
      <TabsList className="grid w-full grid-cols-2 bg-background h-10 mb-4" data-testid="inner-file-tabs">
        <TabsTrigger value="standard" data-testid="tab-file-standard"
          className="data-[state=active]:bg-primary-accent/30 data-[state=active]:text-primary-accent text-muted-foreground gap-1.5 text-sm">
          <Upload className="h-4 w-4" /> Standard
        </TabsTrigger>
        <TabsTrigger value="remote-storage" data-testid="tab-file-remote"
          className="data-[state=active]:bg-primary-accent/30 data-[state=active]:text-primary-accent text-muted-foreground gap-1.5 text-sm">
          <HardDrive className="h-4 w-4" /> Remote Storage
        </TabsTrigger>
      </TabsList>

      <TabsContent value="standard" className="space-y-5 m-0" data-testid="content-file-standard">
        <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-surface/50">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="auto-accept" className="text-sm font-medium">
              Auto-accept files from {peerName}
            </Label>
            <p className="text-xs text-muted-foreground">Automatically download files without confirmation</p>
          </div>
          <Switch id="auto-accept" checked={settings.autoAccept}
            onCheckedChange={onAutoAcceptChange} data-testid="auto-accept-switch" />
        </div>

        <div className="space-y-3 p-4 rounded-lg bg-surface/50">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="max-file-size-to-accept" className="text-sm font-medium">Max file size to accept</Label>
            <span className="text-sm text-primary-accent font-medium" data-testid="max-file-size-value">{maxFileSizeMb} MB</span>
          </div>
          <Slider id="max-file-size-to-accept"
            label="Maximum file size" value={[maxFileSizeMb]} onValueChange={onMaxFileSizeChange}
            max={ACCEPT_LIMIT_MAX_MB} min={1} step={1} className="w-full" data-testid="max-file-size-slider" />
          <p className="text-xs text-muted-foreground">
            Default: {formatSizeLimit(FILE_TRANSFER_DEFAULT_MAX_SIZE_BYTES)}. A browser sends up to {formatSizeLimit(STAGED_UPLOAD_CEILING_BYTES)}; Browse Files, more.
          </p>
        </div>

      </TabsContent>

      <TabsContent value="remote-storage" className="m-0" data-testid="content-file-remote">
        <ChatSettingsRemoteTab
          peerName={peerName} settings={settings}
          revfsQuotaMb={revfsQuotaMb} defaultMaxMb={defaultMaxMb}
          formatSizeLimit={formatSizeLimit} onAllowRevfsChange={onAllowRevfsChange}
          onRevfsQuotaChange={onRevfsQuotaChange}
        />
      </TabsContent>
    </Tabs>
  );
}
