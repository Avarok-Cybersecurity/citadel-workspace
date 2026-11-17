/**
 * GroupSettingsPanel Component
 *
 * Slide-over panel for managing group settings, members, and roles.
 * Contains tabs for Members, Roles, and Settings.
 */

import { useState, useCallback } from 'react';
import { X, Users, Shield, Settings, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useGroupPermissions } from '@/hooks/use-group-permissions';
import { GroupMemberManagement } from './GroupMemberManagement';
import { GroupRoleManagement } from './GroupRoleManagement';
import { GroupDeleteConfirmDialog } from './GroupDeleteConfirmDialog';
import type { GroupSettingsPanelProps } from './group-settings-types';

export function GroupSettingsPanel({
  open,
  onOpenChange,
  tab,
  onTabChange,
  group,
  onNameChange,
  onSettingsChange,
  onMemberRoleChange,
  onKickMember,
  invitablePeers,
  onInviteMember,
  onDeleteGroup,
}: GroupSettingsPanelProps): JSX.Element {
  const { can } = useGroupPermissions(group);
  const [groupName, setGroupName] = useState(group.name);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const canEditSettings: boolean = can('editGroupSettings');
  const canManageRoles: boolean = can('manageRoles');
  const canDeleteGroup: boolean = can('deleteGroup');

  // Handle name save
  const handleNameSave: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (groupName.trim() === group.name) return;

    setIsSaving(true);
    try {
      await onNameChange(groupName.trim());
    } finally {
      setIsSaving(false);
    }
  }, [groupName, group.name, onNameChange]);

  // Handle delete confirmation
  const handleDeleteConfirm = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      await onDeleteGroup();
      onOpenChange(false);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-md bg-background border-l border-border p-0 flex flex-col"
        side="right"
      >
        {/* Header */}
        <SheetHeader className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between gap-4">
            <SheetTitle className="text-foreground text-lg">Group Settings</SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close group settings"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        {/* Tabs */}
        <Tabs
          value={tab}
          onValueChange={(next: string): void => {
            if (next === 'members' || next === 'roles' || next === 'settings') onTabChange(next);
          }}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="mx-4 mt-4 bg-surface border border-border">
            <TabsTrigger
              value="members"
              className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <Users className="h-4 w-4 mr-1" />
              Members
            </TabsTrigger>
            {canManageRoles && (
              <TabsTrigger
                value="roles"
                className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <Shield className="h-4 w-4 mr-1" />
                Roles
              </TabsTrigger>
            )}
            {canEditSettings && (
              <TabsTrigger
                value="settings"
                className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <Settings className="h-4 w-4 mr-1" />
                Settings
              </TabsTrigger>
            )}
          </TabsList>

          {/* Members Tab */}
          <TabsContent value="members" className="flex-1 overflow-auto p-4 mt-0">
            <GroupMemberManagement
              group={group}
              onRoleChange={onMemberRoleChange}
              onKickMember={onKickMember}
              invitablePeers={invitablePeers}
              onInviteMember={onInviteMember}
            />
          </TabsContent>

          {/* Roles Tab */}
          {canManageRoles && (
            <TabsContent value="roles" className="flex-1 overflow-auto p-4 mt-0">
              <GroupRoleManagement group={group} onSettingsChange={onSettingsChange} />
            </TabsContent>
          )}

          {/* Settings Tab */}
          {canEditSettings && (
            <TabsContent value="settings" className="flex-1 overflow-auto p-4 mt-0">
              <div className="space-y-6">
                {/* Group Name */}
                <div className="space-y-2">
                  <Label htmlFor="groupName" className="text-sm text-foreground/80">
                    Group Name
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="groupName"
                      value={groupName}
                      onChange={e => setGroupName(e.target.value)}
                      className="flex-1 bg-surface border-border text-foreground"
                    />
                    <Button
                      onClick={handleNameSave}
                      disabled={isSaving || groupName.trim() === group.name}
                      className="bg-primary text-primary-foreground"
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                </div>

                <Separator className="bg-border" />

                {/* Group Info */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground/80">Group Information</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-surface rounded-lg p-3">
                      <p className="text-muted-foreground">Members</p>
                      <p className="text-foreground font-medium">{group.members.length}</p>
                    </div>
                    <div className="bg-surface rounded-lg p-3">
                      <p className="text-muted-foreground">Roles</p>
                      <p className="text-foreground font-medium">
                        {group.settings.roles.length}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Danger Zone */}
                {canDeleteGroup && (
                  <>
                    <Separator className="bg-border" />

                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-destructive-emphasis">Danger Zone</h4>
                      <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5">
                        <p className="text-sm text-foreground/80 mb-3">
                          Permanently delete this group. This action cannot be undone.
                          All messages and settings will be lost.
                        </p>
                        <Button
                          variant="destructive"
                          onClick={() => setShowDeleteConfirm(true)}
                          className="bg-destructive hover:bg-destructive/90"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Group
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </TabsContent>
          )}
        </Tabs>

        {/* Delete Confirmation Dialog */}
        <GroupDeleteConfirmDialog
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
          groupName={group.name}
          isDeleting={isDeleting}
          onConfirm={handleDeleteConfirm}
        />
      </SheetContent>
    </Sheet>
  );
}

export default GroupSettingsPanel;
