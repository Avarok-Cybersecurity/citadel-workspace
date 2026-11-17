import { useState } from 'react';
import { Eye } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { usePermission } from '@/hooks/use-permission';
import { permits } from '@/hooks/use-permission-result';
import { Permission } from '@/lib/permissions-service/types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { describeFailure } from '@/lib/failure-message';
import WorkspaceService from '@/lib/workspace-service';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

/**
 * "Members can see each other" for one office or room.
 *
 * The value is the node's stored `default_permissions.view_members`, read from
 * the same store the sidebar uses; the server's `Node` answer updates it, so
 * the switch shows what was saved rather than what was clicked. Off, members
 * of this node and of everything inside it see a notice instead of the list;
 * admins and owners still see it.
 *
 * Shown to whoever holds EditWorkspaceConfig, which is what the server asks of
 * SetMembersVisible (it was "Admin" by name, so an Owner never saw it). The
 * workspace itself has no switch: it is not a node.
 */
export function MembersVisibilitySwitch({ entityType, entityId }: { entityType: string; entityId: string }): JSX.Element | null {
  const { state } = useWorkspace();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const configures: boolean = permits(usePermission(WORKSPACE_ROOT_ID, Permission.EditWorkspaceConfig));
  const node: DomainNode | undefined = state.nodes[entityId];
  if (entityType === 'workspace' || !node || !configures) return null;

  const change = async (visible: boolean): Promise<void> => {
    setSaving(true);
    try {
      await WorkspaceService.setMembersVisible(entityId, visible);
    } catch (error) {
      toast({
        title: 'Could not change who sees the member list',
        description: describeFailure(error, 'The server did not accept the change'),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-background rounded-lg" data-testid="members-visible-setting">
      <div className="flex items-start gap-2 min-w-0">
        <Eye className="h-4 w-4 mt-0.5 shrink-0 text-primary-accent" aria-hidden="true" />
        <div className="min-w-0">
          <Label htmlFor="members-visible" className="text-foreground cursor-pointer">
            Members can see each other
          </Label>
          <p id="members-visible-hint" className="text-xs text-muted-foreground">
            When off, only admins and owners can see who is in this {entityType} and everything inside it.
          </p>
        </div>
      </div>
      <Switch
        id="members-visible"
        checked={node.default_permissions.view_members}
        disabled={saving}
        onCheckedChange={(visible: boolean): void => { void change(visible); }}
        aria-describedby="members-visible-hint"
        data-testid="members-visible-toggle"
      />
    </div>
  );
}
