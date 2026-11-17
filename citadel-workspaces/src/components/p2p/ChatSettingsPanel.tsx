import { ConnectionFacts } from './ConnectionFacts';
import { useState } from 'react';
import {
  getPrivacySettings,
  savePrivacySettings,
  type PrivacySettings,
} from '@/lib/privacy-settings';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClearHistoryButton } from './ClearHistoryButton';
import { PauseConnectionControl } from './PauseConnectionControl';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ChatSettingsAdvanced } from './ChatSettingsAdvanced';
import {
  Settings,
  FileText,
  Sliders,
  BarChart3,
  Eye,
  MessageSquare
} from 'lucide-react';
import { useChatSettings } from './useChatSettings';
import { ChatSettingsFileTab } from './ChatSettingsFileTab';

interface ChatSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  peerCid: string;
  peerName: string;
}

export function ChatSettingsPanel({
  isOpen,
  onClose,
  peerCid,
  peerName,
}: ChatSettingsPanelProps): JSX.Element {

  // The workspace-wide privacy settings, so this panel's switches and the
  // Privacy settings tab cannot disagree about what is being broadcast.
  const [privacy, setPrivacy] = useState<PrivacySettings>(getPrivacySettings);
  const updatePrivacy = <K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]): void => {
    setPrivacy((prev) => {
      const next: PrivacySettings = { ...prev, [key]: value };
      savePrivacySettings(next);
      return next;
    });
  };
  const {
    stats,
    activeOuterTab,
    setActiveOuterTab,
    activeFileTab,
    setActiveFileTab,
    settings,
    maxFileSizeMb,
    revfsQuotaMb,
    defaultMaxMb,
    formatSizeLimit,
    handleAutoAcceptChange,
    handleMaxFileSizeChange,
    handleAllowRevfsChange,
    handleRevfsQuotaChange,
  } = useChatSettings(isOpen, peerCid);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-background border-surface text-foreground sm:max-w-[600px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-primary/20">
              <Settings className="h-5 w-5 text-primary-accent" />
            </div>
            <DialogTitle className="text-lg font-semibold">
              Chat Settings
            </DialogTitle>
          </div>
          <DialogDescription className="text-muted-foreground">
            Configure your chat preferences with {peerName}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeOuterTab} onValueChange={setActiveOuterTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-4 bg-surface h-12 flex-shrink-0" data-testid="outer-tabs">
            <TabsTrigger
              value="general"
              data-testid="tab-general"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground gap-1.5"
             aria-label="General"
            >
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">General</span>
            </TabsTrigger>
            <TabsTrigger
              value="file"
              data-testid="tab-file"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground gap-1.5"
             aria-label="File"
            >
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">File</span>
            </TabsTrigger>
            <TabsTrigger
              value="advanced"
              data-testid="tab-advanced"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground gap-1.5"
             aria-label="Advanced"
            >
              <Sliders className="h-4 w-4" />
              <span className="hidden sm:inline">Advanced</span>
            </TabsTrigger>
            <TabsTrigger
              value="stats"
              data-testid="tab-stats"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground gap-1.5"
             aria-label="Stats"
            >
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Stats</span>
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4">
            {/* General Tab */}
            <TabsContent value="general" className="space-y-6 m-0" data-testid="content-general">
              <PauseConnectionControl peerCid={BigInt(peerCid)} peerName={peerName} />
              <div className="space-y-4">
                {/* These are the workspace-wide privacy settings, not
                    per-conversation ones — they were uncontrolled `Switch
                    defaultChecked` here, with no handler and no store, so
                    turning read receipts or typing indicators OFF in this panel
                    changed nothing and both kept flowing. On a product whose
                    subject is privacy, a switch that lies about what you are
                    broadcasting is the worst kind to fake. Bound to the same
                    store the Privacy settings tab writes. */}
                <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-surface/50">
                  <div className="flex items-center gap-3">
                    <Eye className="h-5 w-5 text-primary-accent" />
                    <div>
                      <Label htmlFor="read-receipts" className="text-sm font-medium">Read Receipts</Label>
                      <p className="text-xs text-muted-foreground">Show when you've read messages</p>
                    </div>
                  </div>
                  <Switch
                    id="read-receipts"
                    checked={privacy.sendReadReceipts}
                    onCheckedChange={(v) => updatePrivacy('sendReadReceipts', v)}
                  />
                </div>

                <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-surface/50">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="h-5 w-5 text-success-emphasis" />
                    <div>
                      <Label htmlFor="typing-indicators" className="text-sm font-medium">Typing Indicators</Label>
                      <p className="text-xs text-muted-foreground">Show when you're typing</p>
                    </div>
                  </div>
                  <Switch
                    id="typing-indicators"
                    checked={privacy.showTypingIndicators}
                    onCheckedChange={(v) => updatePrivacy('showTypingIndicators', v)}
                  />
                </div>

                <p className="text-xs text-muted-foreground px-1">
                  These apply to every conversation, and match what you set under
                  Settings → Privacy.
                </p>
              </div>
            </TabsContent>

            {/* File Tab with Inner Tabs */}
            <TabsContent value="file" className="m-0" data-testid="content-file">
              <ChatSettingsFileTab
                peerName={peerName}
                activeFileTab={activeFileTab}
                setActiveFileTab={setActiveFileTab}
                settings={settings}
                maxFileSizeMb={maxFileSizeMb}
                revfsQuotaMb={revfsQuotaMb}
                defaultMaxMb={defaultMaxMb}
                formatSizeLimit={formatSizeLimit}
                onAutoAcceptChange={handleAutoAcceptChange}
                onMaxFileSizeChange={handleMaxFileSizeChange}
                onAllowRevfsChange={handleAllowRevfsChange}
                onRevfsQuotaChange={handleRevfsQuotaChange}
              />
            </TabsContent>

            {/* Advanced Tab */}
            <TabsContent value="advanced" className="space-y-4 m-0" data-testid="content-advanced">
              <div className="space-y-4">
                <ChatSettingsAdvanced isOpen={isOpen} peerCid={BigInt(peerCid)} peerName={peerName} />

                <ClearHistoryButton peerCid={BigInt(peerCid)} peerName={peerName} />
              </div>
            </TabsContent>

            {/* Stats Tab */}
            <TabsContent value="stats" className="space-y-4 m-0" data-testid="content-stats">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded-lg bg-surface/50 text-center">
                    <BarChart3 className="h-5 w-5 text-primary-accent mx-auto mb-2" />
                    <p className="text-2xl font-bold text-foreground">
                      {stats.messages}
                    </p>
                    <p className="text-xs text-muted-foreground">Messages</p>
                  </div>
                  <div className="p-4 rounded-lg bg-surface/50 text-center">
                    <FileText className="h-5 w-5 text-primary-accent mx-auto mb-2" />
                    <p className="text-2xl font-bold text-foreground">
                      {stats.files}
                    </p>
                    <p className="text-xs text-muted-foreground">Files Transferred</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <ConnectionFacts peerCid={peerCid} firstContact={stats.firstContact} transferredBytes={stats.transferredBytes} />
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
