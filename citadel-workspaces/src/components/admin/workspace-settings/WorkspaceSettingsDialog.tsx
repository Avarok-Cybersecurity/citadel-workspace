/**
 * Workspace settings: the workspace's name, description and icon, sign-in and messaging trust,
 * and its appearance.
 *
 * Live (owner, 2026-09-27): "I can't find where to edit the workspace settings (name of org,
 * icon, etc)". Nothing opened a settings screen for the workspace itself, and the only rename
 * request demanded the master password. This saves through UpdateWorkspaceProfile, gated on
 * Permission::UpdateWorkspace, and closes only once the server has accepted the change.
 *
 * Mounted only while open (see AdminSettingsSection), so the form is seeded from the stored
 * record every time it opens and never shows a stale copy.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AvatarUpload } from '@/components/settings/AvatarUpload';
import { WORKSPACE_ICON } from '@/components/settings/image-upload-kinds';
import { WorkspaceAppearanceSection } from '@/components/settings/WorkspaceAppearanceSection';
import { kernelAdmissionSetting } from '@/lib/admission/workspace-setting';
import { TurnstileAdmissionSwitch } from './TurnstileAdmissionSwitch';
import { MessagingTrustSection } from './MessagingTrustSection';
import { TelemetrySection } from './telemetry/TelemetrySection';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/hooks/use-toast';
import { toastSuccess } from '@/lib/toast-helpers';
import { describeFailure } from '@/lib/failure-message';
import { workspaceLogoOf } from '@/lib/workspace-metadata/workspace-logo';
import WorkspaceService from '@/lib/workspace-service';
import { profileChangeFrom, MAX_DESCRIPTION_CHARS, MAX_NAME_CHARS, type ProfileForm, type ProfileChangeResult } from './profile-change';

interface WorkspaceSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkspaceSettingsDialog({ open, onOpenChange }: WorkspaceSettingsDialogProps): JSX.Element {
  const { state } = useWorkspace();
  const { toast } = useToast();
  const workspaceId: string | undefined = state.workspace?.id;
  const stored: ProfileForm = {
    name: state.workspace?.name ?? '',
    description: state.workspace?.description ?? '',
    icon: workspaceLogoOf(state.workspace?.metadata),
  };
  const [form, setForm] = useState<ProfileForm>((): ProfileForm => stored);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const result: ProfileChangeResult = profileChangeFrom(stored, form);
  const canSave: boolean = workspaceId !== undefined && result.ok && result.change !== null && !saving;

  const save: () => Promise<void> = async (): Promise<void> => {
    if (!workspaceId || !result.ok || result.change === null) return;
    setSaving(true);
    setProblem(null);
    try {
      await WorkspaceService.updateWorkspaceProfile(workspaceId, result.change);
      toastSuccess(toast, 'Workspace settings saved');
      onOpenChange(false);
    } catch (error) {
      setProblem(describeFailure(error, 'The workspace settings could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const shownProblem: string | null = problem ?? (result.ok ? null : result.reason);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="workspace-settings-dialog">
        <DialogHeader>
          <DialogTitle>Workspace settings</DialogTitle>
          <DialogDescription>Every member sees these in the workspace switcher.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row gap-6 items-start">
          <AvatarUpload
            kind={WORKSPACE_ICON}
            currentAvatar={stored.icon ?? undefined}
            onAvatarChange={(icon: string | null) => setForm((f: ProfileForm) => ({ ...f, icon }))}
            disabled={saving}
          />
          <div className="flex-1 w-full space-y-4">
            <div className="space-y-2">
              <Label htmlFor="workspace-settings-name">Name</Label>
              <Input
                id="workspace-settings-name"
                data-testid="workspace-settings-name"
                value={form.name}
                maxLength={MAX_NAME_CHARS}
                onChange={(e) => setForm((f: ProfileForm) => ({ ...f, name: e.target.value }))}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-settings-description">Description</Label>
              <Textarea
                id="workspace-settings-description"
                data-testid="workspace-settings-description"
                value={form.description}
                maxLength={MAX_DESCRIPTION_CHARS}
                rows={3}
                onChange={(e) => setForm((f: ProfileForm) => ({ ...f, description: e.target.value }))}
                disabled={saving}
              />
            </div>
          </div>
        </div>

        {shownProblem && <p role="alert" className="text-sm text-destructive-emphasis">{shownProblem}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => { const _: Promise<void> = save(); }} disabled={!canSave} data-testid="workspace-settings-save">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>

        <div className="border-t border-border pt-4">
          <TurnstileAdmissionSwitch port={kernelAdmissionSetting} />
        </div>

        <div className="border-t border-border pt-4">
          <MessagingTrustSection />
        </div>

        <div className="border-t border-border pt-4">
          <WorkspaceAppearanceSection />
        </div>

        <div className="border-t border-border pt-4 empty:hidden">
          <TelemetrySection />
        </div>
      </DialogContent>
    </Dialog>
  );
}
