import { useState, useEffect } from 'react';
import type { RoleDefinition } from 'citadel-workspace-client-ts';
import { describeFailure } from '@/lib/failure-message';
import { isForDomain } from '@/lib/workspace-events/is-for-domain';
import { useMemberAdminActions } from './use-member-admin-actions';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog';
import { RecoveryNotice } from '@/components/recovery-route/RecoveryNotice';
import { recovery } from '@/lib/recovery-route/recovery';
import type { AdminTabProps, MemberData } from '../types';
import WorkspaceService from '@/lib/workspace-service';
import { workspaceEvents, type MembersPayload } from '@/lib/workspace-events';
import { MemberPermissionsDialog } from '@/components/permissions/MemberPermissionsDialog';
import { asMemberData, asPermissionSubject } from './member-data';
import { BannedSection } from './BannedSection';
import { usePermission } from '@/hooks/use-permission';
import { confirms } from '@/hooks/use-permission-result';
import { Loader2, Shield } from 'lucide-react';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { armLoadingDeadline, cancelLoadingDeadline } from '@/lib/loading-flag-timeout';
import { debugLog } from '@/lib/debug-config';
import { MemberRow } from './MemberRow';
import { useMemberRowRules, type MemberRules } from './use-member-row-rules';
import { RoleLegend } from './RoleLegend';
import { useLevelName } from '@/hooks/use-level-name';
import { MembersVisibilitySwitch } from './MembersVisibilitySwitch';
import { MembersFilter } from './MembersFilter';
import { membersShown, type MembersFilterChoice } from './members-filter';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

export function MembersTab({ entityType, entityId, onClose: _onClose }: AdminTabProps): JSX.Element {
  const deadlineKey: string = `admin-members:${entityId}`; // per entity: modals must not clash
  const [members, setMembers] = useState<MemberData[]>([]);
  const [loading, setLoading] = useState(true);
  // Why the last load produced no list. Shown in place of the list: an empty roster after a failed
  // load read as "No members found", which was untrue.
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberData | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<MemberData | null>(null);
  const [filter, setFilter] = useState<MembersFilterChoice>('everyone');
  const nameOfLevel: (levelId: string) => string = useLevelName();

  useEffect(() => {
    runAsyncSetup(loadMembers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  // listMembers() dispatches a request and returns void; the result arrives as a
  // `members:loaded` event. This used to `await` that call and branch on the
  // return value, with a comment noting the branch was dead — so it always fell
  // through to a fallback over state.members, which is empty here, and the tab
  // reported "No members found" no matter who was in the workspace. Subscribing
  // is what MembersSection in the sidebar already does; this now matches it.
  useEffect(() => {
    const handleMembersLoaded = (payload: MembersPayload): void => {
      if (!payload.members) return;
      // Someone else's domain, arriving while this tab is open, used to render
      // here -- and the role changes and removals below would then name THIS
      // entity with users taken from that list.
      if (!isForDomain(payload.domainId, entityId)) return;
      const guests: ReadonlySet<string> = new Set(payload.guests);
      setMembers(
        payload.members.map((m) => asMemberData(m, {
          accessViaName: payload.inheritedFrom?.[m.id] === undefined ? undefined : nameOfLevel(payload.inheritedFrom[m.id]),
          isGuest: guests.has(m.id),
        }))
      );
      cancelLoadingDeadline(deadlineKey);
      setLoadFailure(null);
      setLoading(false);
    };
    // Return the unsubscribe — see use-domain-members.ts for why the async
    // wrapper that used to swallow it leaked a listener per tab visit.
    return workspaceEvents.onMemberEvent('members:loaded', handleMembersLoaded);
  }, [deadlineKey, entityId, nameOfLevel]);

  const loadMembers = async (): Promise<void> => {
    setLoading(true);
    setLoadFailure(null);
    // listMembers resolves on SEND and loading was cleared only by the success
    // event, so a refusal left the panel spinning (useMemberEventSetup has had this).
    armLoadingDeadline(deadlineKey, () => {
      setLoadFailure('The server did not send the member list.');
      setLoading(false);
    });
    try {
      await WorkspaceService.listMembers(entityId);
    } catch (error) {
      debugLog('MembersTab', 'Failed to request members:', error);
      cancelLoadingDeadline(deadlineKey);
      setLoadFailure(describeFailure(error, 'The member list could not be loaded.'));
      setLoading(false);
    }
  };

  const { updatingRoles, changeRole, removeMember, setBanned } = useMemberAdminActions(entityId, setMembers);
  const [memberToBan, setMemberToBan] = useState<MemberData | null>(null);
  // A ban is workspace-wide, so it is offered on the workspace's own roster. Lifting one needs no
  // confirmation; imposing one does, as removal does.
  const handleSetBanned: ((member: MemberData, banned: boolean) => void) | undefined = entityId === WORKSPACE_ROOT_ID
    ? (member: MemberData, banned: boolean): void => { if (banned) setMemberToBan(member); else void setBanned(member, false); }
    : undefined;

  const liftsBans: boolean = confirms(usePermission(WORKSPACE_ROOT_ID, 'RemoveUsers'));

  const handleRoleChange: (userId: string, newRole: RoleDefinition) => Promise<void> = changeRole;
  const rulesFor: MemberRules = useMemberRowRules();

  const handleRemoveMember = async (): Promise<void> => {
    if (!memberToRemove) return;
    try {
      await removeMember(memberToRemove);
    } finally {
      setMemberToRemove(null);
    }
  };

  const handleAdvancedPermissions = (member: MemberData): void => {
    setSelectedMember(member);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8" data-testid="members-tab-loading">
        <Loader2 className="h-6 w-6 animate-spin text-primary-accent" />
      </div>
    );
  }

  if (loadFailure !== null) {
    return <RecoveryNotice className="py-6" recovery={recovery('list.load-failed', { retry: loadMembers })} title="Members could not be loaded" message={loadFailure} />;
  }

  const shown: MemberData[] = membersShown(members, filter);
  return (
    <div className="space-y-4" data-testid="members-tab-content">
      <MembersVisibilitySwitch entityType={entityType} entityId={entityId} />
      {/* Advanced Toggle */}
      <div className="flex items-center justify-between gap-4 p-3 bg-background rounded-lg">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary-accent" />
          <Label htmlFor="advanced-toggle" className="text-foreground cursor-pointer">
            Show Advanced Permissions
          </Label>
        </div>
        <Switch
          id="advanced-toggle"
          checked={showAdvanced}
          onCheckedChange={setShowAdvanced}
          data-testid="members-advanced-toggle"
        />
      </div>

      <MembersFilter members={members} value={filter} onChange={setFilter} />
      {/* Members List */}
      <ScrollArea className="h-[300px] pr-4">
        <div className="space-y-2" id="members-tab-list">
          {shown.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {filter === 'guests' ? 'No guests here' : 'No members found'}
            </div>
          ) : (
            shown.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                showAdvanced={showAdvanced}
                rules={rulesFor(member)}
                isUpdatingRole={updatingRoles.has(member.userId)}
                onRoleChange={handleRoleChange}
                onAdvancedPermissions={handleAdvancedPermissions}
                onRemove={setMemberToRemove}
                onSetBanned={handleSetBanned}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {entityId === WORKSPACE_ROOT_ID && (
        <BannedSection allowed={liftsBans} onUnban={(member: MemberData): void => { void setBanned(member, false); }} />
      )}

      <RoleLegend />

      {/* One member's permissions at THIS tab's level -- the view about them, not the role matrix,
          which answered a question about one person with four role columns. */}
      {selectedMember && (
        <MemberPermissionsDialog
          open
          onClose={() => setSelectedMember(null)}
          member={asPermissionSubject(selectedMember)}
          domainId={entityId}
        />
      )}

      {/* Remove Member Confirmation */}
      <ConfirmDeleteDialog
        open={!!memberToRemove}
        onOpenChange={() => setMemberToRemove(null)}
        title="Remove Member"
        description={`Are you sure you want to remove ${memberToRemove?.name || memberToRemove?.username} from this ${entityType}? They will lose access to all content.`}
        onConfirm={handleRemoveMember}
        confirmLabel="Remove"
      />

      <ConfirmDeleteDialog
        open={!!memberToBan}
        onOpenChange={() => setMemberToBan(null)}
        title="Ban Member"
        description={`Ban ${memberToBan?.name || memberToBan?.username}? They lose their role and every permission, and cannot rejoin until unbanned.`}
        onConfirm={async (): Promise<void> => { if (memberToBan) await setBanned(memberToBan, true); setMemberToBan(null); }}
        confirmLabel="Ban"
      />
    </div>
  );
}
