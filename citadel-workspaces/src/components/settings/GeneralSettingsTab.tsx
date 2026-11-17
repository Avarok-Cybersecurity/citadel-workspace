import { useState, useEffect, useCallback } from 'react';
import { describeFailure } from '@/lib/failure-message';
import { debugLog } from '@/lib/debug-config';
import { Save, Loader2, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { loadCallSoundSettings, saveCallSoundSettings } from '@/lib/call/call-sound-preferences';
import { useToast, useEventListener } from '@/hooks';
import { AvatarUpload } from './AvatarUpload';
import { PROFILE_PICTURE } from './image-upload-kinds';
import { ProfileDetailsFields, profileDetailsAreValid, type ProfileDetailsValues } from './ProfileDetailsFields';
import { metadataText, profileFieldsFromMetadata, PROFILE_METADATA_KEYS } from '@/lib/profile-metadata';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import WorkspaceService from '@/lib/workspace-service';
import userService from '@/lib/user-service';
import type { User } from 'citadel-workspace-client-ts';
import type { UserRegistrationInfo } from '@/lib/user-service';
import { AgentUpdateRow } from './AgentUpdateRow';

export function GeneralSettingsTab(): JSX.Element {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState('');
  // Seeded from the member record the workspace already loaded for this user.
  // The avatar is held as the data URL it arrives as; it is only sent if replaced.
  const { state: workspaceState } = useWorkspace();
  const storedAvatar: string | null = workspaceState.currentUser?.avatarUrl ?? null;
  const [avatarData, setAvatarData] = useState<string | null>(storedAvatar);
  const [originalDisplayName, setOriginalDisplayName] = useState('');
  const [originalAvatarData, setOriginalAvatarData] = useState<string | null>(storedAvatar);
  const storedDetails: ProfileDetailsValues = {
    email: workspaceState.currentUser?.email ?? '',
    title: workspaceState.currentUser?.title ?? '',
  };
  const [details, setDetails] = useState<ProfileDetailsValues>(storedDetails);
  const [originalDetails, setOriginalDetails] = useState<ProfileDetailsValues>(storedDetails);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [callSoundsEnabled, setCallSoundsEnabled] = useState(() => loadCallSoundSettings().enabled);

  // Saved on change like the privacy toggles — this is a device preference,
  // not part of the profile form, so it does not wait on the Save button.
  const handleCallSoundsChange = (enabled: boolean): void => {
    setCallSoundsEnabled(enabled);
    saveCallSoundSettings({ enabled });
  };

  // Load current user data on mount
  useEffect(() => {
    const loadUser = async (): Promise<void> => {
      const currentUser: UserRegistrationInfo | null = await userService.getCurrentUser();
      if (currentUser) {
        setDisplayName(currentUser.fullName || currentUser.username);
        setOriginalDisplayName(currentUser.fullName || currentUser.username);
      }
      setIsLoading(false);
    };
    loadUser().catch((err: unknown) => debugLog('GeneralSettingsTab', 'Failed to load user:', err));
  }, []);

  // Handle profile updates
  // MetadataValue is a tagged enum: { type: "String", content: "..." }
  const handleProfileUpdate: (data: { user: User; }) => void = useCallback((data: { user: User }): void => {
    // The whole record arrives, so no avatar means it was removed.
    const avatar: string | null = metadataText(data.user.metadata, PROFILE_METADATA_KEYS.avatar) ?? null;
    setAvatarData(avatar);
    setOriginalAvatarData(avatar);
    // The whole record arrives, so an absent field was cleared, not left out.
    const saved: { email?: string; title?: string } = profileFieldsFromMetadata(data.user.metadata);
    const savedDetails: ProfileDetailsValues = { email: saved.email ?? '', title: saved.title ?? '' };
    setDetails(savedDetails);
    setOriginalDetails(savedDetails);
    if (data.user.name) {
      setDisplayName(data.user.name);
      setOriginalDisplayName(data.user.name);
    }
    toast({
      title: 'Profile Updated',
      description: 'Your profile has been saved successfully.',
    });
    setIsSaving(false);
  }, [toast]);

  // Listen for profile updates
  useEventListener<{ user: User }>('user:profile-updated', handleProfileUpdate);

  const detailsChanged = (field: keyof ProfileDetailsValues): boolean => details[field].trim() !== originalDetails[field];
  const hasChanges: boolean = displayName !== originalDisplayName || avatarData !== originalAvatarData
    || detailsChanged('email') || detailsChanged('title');
  const canSave: boolean = hasChanges && profileDetailsAreValid(details);

  const handleSave = async (): Promise<void> => {
    if (!canSave) return;

    setIsSaving(true);
    try {
      // A removed avatar or emptied email/title is sent as '' — the server's "clear it".
      await WorkspaceService.updateUserProfile({
        name: displayName !== originalDisplayName ? displayName : undefined,
        avatarData: avatarData !== originalAvatarData ? (avatarData ?? '') : undefined,
        email: detailsChanged('email') ? details.email.trim() : undefined,
        title: detailsChanged('title') ? details.title.trim() : undefined,
      });
      // The response handler will emit 'user:profile-updated' which updates state
    } catch (error) {
      debugLog('GeneralSettingsTab', 'Failed to update profile:', error);
      toast({
        title: 'Error',
        description: describeFailure(error, 'Failed to save profile. Please try again.'),
        variant: 'destructive',
      });
      setIsSaving(false);
    }
  };

  const handleAvatarChange = (base64Data: string | null): void => {
    setAvatarData(base64Data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">User Profile</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Update your photo and personal details</p>
        </div>

        <div className="flex flex-col md:flex-row gap-6 items-start">
          {/* Avatar */}
          <div className="flex-shrink-0">
            <AvatarUpload
              kind={PROFILE_PICTURE}
              currentAvatar={avatarData || undefined}
              onAvatarChange={handleAvatarChange}
              disabled={isSaving}
            />
          </div>

          {/* Name Input */}
          <div className="flex-1 space-y-4 w-full">
            <div className="space-y-1.5">
              <label htmlFor="displayName" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                Display Name
              </label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your display name"
                disabled={isSaving}
                className="bg-input border-border text-foreground h-11 rounded-lg placeholder:text-muted-foreground focus:border-primary-accent focus:ring-1 focus:ring-ring/30 transition-all"
              />
              <p className="text-xs text-muted-foreground">
                This is how your name appears to other workspace members.
              </p>
            </div>
            <ProfileDetailsFields
              idPrefix="settings"
              values={details}
              onChange={(field, value) => setDetails((prev) => ({ ...prev, [field]: value }))}
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground">
              Your picture, email and job title are visible to members of this workspace. Clear a field to remove it.
            </p>
          </div>
        </div>
      </div>

      {/* Sounds */}
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
          <Volume2 className="h-4 w-4 text-primary-accent" />
          Sounds
        </div>
        <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-background/50">
          <div className="min-w-0">
            {/* htmlFor/id, not proximity. A Switch renders a <button> with no
                inner text, so a Label merely sitting next to it gives a screen
                reader a control announced as nothing at all — axe rates that
                critical, and it is the one thing that makes a toggle unusable
                without sight. */}
            <Label htmlFor="call-sounds" className="text-sm font-medium">
              Call sounds
            </Label>
            <p id="call-sounds-description" className="text-xs text-muted-foreground">
              Ring for incoming calls and while waiting for someone to answer
            </p>
          </div>
          <Switch
            id="call-sounds"
            aria-describedby="call-sounds-description"
            checked={callSoundsEnabled}
            onCheckedChange={handleCallSoundsChange}
            data-testid="call-sounds-toggle"
          />
        </div>
      </div>

      {/* The local agent's updates */}
      <div className="space-y-3 pt-4 border-t border-border">
        <AgentUpdateRow />
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t border-border">
        <Button
          onClick={handleSave}
          disabled={!canSave || isSaving}
          className="bg-primary hover:bg-primary/90 disabled:opacity-50 rounded-lg shadow-lg shadow-primary-accent/20 gap-2"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
