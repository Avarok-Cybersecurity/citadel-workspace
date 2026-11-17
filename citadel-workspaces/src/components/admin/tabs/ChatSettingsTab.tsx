import { useState, useEffect, useRef  , type MutableRefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { AdminTabProps } from '../types';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import WorkspaceService from '@/lib/workspace-service';
import { saveChatSettings, MAX_CHAT_RULES_LENGTH } from './save-chat-settings';
import { Loader2, MessageSquare, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { debugLog } from '@/lib/debug-config';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

export function ChatSettingsTab({ entityType, entityId, onClose: _onClose }: AdminTabProps): JSX.Element {
  const { toast } = useToast();
  const { state } = useWorkspace();
  const [chatEnabled, setChatEnabled] = useState(true);
  const [chatRules, setChatRules] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalEnabled, setOriginalEnabled] = useState(true);
  const [originalRules, setOriginalRules] = useState('');
  const seededKeyRef: MutableRefObject<string | null> = useRef<string | null>(null);
  const dirtyRef: MutableRefObject<boolean> = useRef(false);

  useEffect(() => {
    // `state.nodes` is re-minted by ANY node event in the workspace — including a
    // teammate saving an unrelated document — so this effect re-runs constantly.
    // Re-seeding then replaced whatever the admin was typing AND reset the
    // originals, flipping hasChanges back to false so Save greyed out: the work
    // was gone and the UI denied it had existed.
    //
    // An untouched form still follows the store, which is what makes a genuine
    // remote rename visible. Only unsaved edits are protected.
    const entityKey: string = `${entityType}:${entityId}`;
    if (seededKeyRef.current === entityKey && dirtyRef.current) return;
    seededKeyRef.current = entityKey;

    const loadData = (): void => {
      setLoading(true);
      // Same store the sidebar and BaseOffice read from, so the tab cannot
      // disagree with what the rest of the app shows. Until the node is there,
      // stay loading: a switch shown ON for a node not yet read is a guess, and
      // Save would write it. This effect re-runs when the node arrives.
      const node: DomainNode | undefined = state.nodes[entityId];
      if (!node) return;
      try {
        const enabled: boolean = node.chat_enabled;
        const rules: string = node.rules ?? '';

        setChatEnabled(enabled);
        setChatRules(rules);
        setOriginalEnabled(enabled);
        setOriginalRules(rules);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [entityType, entityId, state.nodes]);

  useEffect(() => {
    const dirty: boolean = chatEnabled !== originalEnabled || chatRules !== originalRules;
    setHasChanges(dirty);
    dirtyRef.current = dirty;
  }, [chatEnabled, chatRules, originalEnabled, originalRules]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    const saved: boolean = await saveChatSettings({
      entityType,
      entityId,
      chatEnabled,
      chatRules,
      write: (nodeId, update) =>
        WorkspaceService.updateNode(nodeId, { chatEnabled: update.chatEnabled, rules: update.rules }),
      notify: ({ kind, title, description }) =>
        toast({ title, description, variant: kind === 'success' ? 'success' : 'destructive' }),
      log: (message, error) => debugLog('ChatSettingsTab', message, error),
    });
    setSaving(false);

    // Only clear the dirty flag once the settings actually reached the server;
    // otherwise the form would look saved while the edits existed only here.
    if (saved) {
      setOriginalEnabled(chatEnabled);
      setOriginalRules(chatRules);
      setHasChanges(false);
    }
  };

  const handleReset = (): void => {
    setChatEnabled(originalEnabled);
    setChatRules(originalRules);
  };

  // The workspace level has no chat of its own (chat is per office/room), and no node in the
  // store to wait for: waiting for one left this tab spinning for ever.
  if (entityType === 'workspace') {
    return (
      <div className="space-y-4" data-testid="chat-tab-workspace-message">
        <Alert className="bg-background border-primary-accent">
          <Info className="h-4 w-4 text-primary-accent" />
          <AlertDescription className="text-foreground/80">
            Chat settings are configured individually for each office and room.
            Select an office or room from the sidebar to configure its chat settings.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8" data-testid="chat-tab-loading">
        <Loader2 className="h-6 w-6 animate-spin text-primary-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="chat-tab-content">
      {/* Chat Enable Toggle */}
      <div className="flex items-center justify-between gap-4 p-4 bg-background rounded-lg">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-5 w-5 text-primary-accent" />
          <div>
            <Label htmlFor="chat-enabled" className="text-foreground font-medium cursor-pointer">
              Enable Chat
            </Label>
            <p className="text-sm text-muted-foreground">
              Allow members to send messages in this {entityType}
            </p>
          </div>
        </div>
        <Switch
          id="chat-enabled"
          checked={chatEnabled}
          onCheckedChange={setChatEnabled}
          data-testid="chat-enabled-toggle"
        />
      </div>

      {/* Chat Rules */}
      <div className="space-y-2">
        <Label htmlFor="chat-rules" className="text-foreground">
          Chat Rules & Guidelines
        </Label>
        <Textarea
          id="chat-rules"
          value={chatRules}
          onChange={(e) => setChatRules(e.target.value)}
          placeholder="Enter chat rules and guidelines for members (optional)&#10;&#10;Example:&#10;- Be respectful to all members&#10;- No spam or self-promotion&#10;- Stay on topic"
          className="bg-card border-surface text-foreground placeholder:text-muted-foreground min-h-[150px]"
          disabled={!chatEnabled}
          maxLength={MAX_CHAT_RULES_LENGTH}
          aria-describedby="chat-rules-hint"
          data-testid="chat-rules-textarea"
        />
        <div className="flex items-start justify-between gap-4">
          <p id="chat-rules-hint" className="text-xs text-muted-foreground">
            These rules will be shown to members before they can send messages
          </p>
          <p className="text-xs text-muted-foreground shrink-0 tabular-nums" data-testid="chat-rules-count">
            {chatRules.length} / {MAX_CHAT_RULES_LENGTH}
          </p>
        </div>
      </div>

      {/* Additional Settings Preview */}
      {chatEnabled && (
        <div className="p-4 bg-background rounded-lg space-y-3">
          <h4 className="text-foreground font-medium text-sm">Chat Features</h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-success" />
              Text messages
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-success" />
              File sharing
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-success" />
              Message reactions
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-warning" />
              Threads (planned)
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 pt-4">
        <Button
          variant="outline"
          onClick={handleReset}
          disabled={!hasChanges || saving}
          className="border-border text-foreground hover:bg-card"
          data-testid="chat-reset-button"
        >
          Reset
        </Button>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
          data-testid="chat-save-button"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Changes'
          )}
        </Button>
      </div>
    </div>
  );
}
