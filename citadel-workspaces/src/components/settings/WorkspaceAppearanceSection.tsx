import { lazy, Suspense, useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Palette } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Permission } from '@/contexts/PermissionsContext';
import { usePermission } from '@/hooks/use-permission';
import { permits } from '@/hooks/use-permission-result';
import { useWorkspaceTheme } from '@/lib/theme/workspace-theme-context';
import { serializeTheme } from '@/lib/theme/theme-serialization';
import WorkspaceService from '@/lib/workspace-service';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import type { WorkspaceTheme } from '@/lib/theme/theme-types';
import { debugLog } from '@/lib/debug-config';

/**
 * Lazily loaded: the editor carries a colour wheel and every preset palette, and
 * is opened rarely. Keeping it out of the initial chunk protects the landing
 * critical-path budget that check-bundle-budget.mjs enforces.
 */
const WorkspaceAppearanceModal: ReturnType<typeof lazy> = lazy(() =>
  import('@/components/theme/WorkspaceAppearanceModal').then((m) => ({
    default: m.WorkspaceAppearanceModal,
  })),
);

/**
 * Entry point for the workspace theme, sitting beside the personal light/dark
 * choice.
 *
 * The two live together deliberately: this is the one place a user asks "how
 * does this look", and the adjacency makes the split legible — the workspace
 * picks the colours, you pick light or dark.
 */
export function WorkspaceAppearanceSection(): JSX.Element {
  const { state } = useWorkspace();
  const { theme, isDefault } = useWorkspaceTheme();
  const [open, setOpen] = useState(false);

  const workspaceId: string | undefined = state.workspace?.id;

  // Two things had to be handled here, both found by running the Playwright spec
  // rather than by reading the code.
  //
  // 1. PermissionsContext only SYNCS from the service cache; it never fetches.
  //    A check against a domain nobody loaded returns false, which is
  //    indistinguishable from a genuine denial.
  // 2. The creator's permissions are stored against the WORKSPACE'S ID —
  //    async_domain_server_ops calls set_role_permissions(&workspace_id) — while
  //    the sentinel 'workspace-root' carries none. Asking only for the sentinel
  //    reports the workspace's own admin as an unprivileged member.
  //
  // So both domains are asked, and either may grant.
  //
  // Through `usePermission` rather than a fetch-once effect. That effect asked
  // each domain exactly once: a fetch that returned null — a request sent
  // before this tab knew who was signed in, say — left `canEdit` false for the
  // life of the page, with no retry, no reason, and the copy below telling the
  // workspace's own owner that an admin had set their theme. Every one of
  // those problems already had a fix in `usePermission`; this was the second
  // gate, and it had inherited none of them.
  const root: ReturnType<typeof usePermission> = usePermission(WORKSPACE_ROOT_ID, Permission.Themes);
  const own: ReturnType<typeof usePermission> = usePermission(workspaceId, Permission.Themes);

  // `permits`, not `allowed`: this had two of the four not-a-denial states
  // and missed `answered`, so a cache miss showed the workspace's own owner a
  // read-only theme editor. See hooks/use-permission-result.ts.
  const canEdit: boolean = permits(root) || permits(own);

  // "Not an admin" and "we never got an answer" are different sentences, and
  // only the second one is a fault worth reporting. `usePermission` already
  // tells them apart; this is the first gate to say so out loud.
  const unchecked: boolean = !canEdit && !root.loading && !own.loading && root.unanswered;

  // "Why is this greyed out?" is a real support question, and the answer lives
  // in state nobody can see. Logging the inputs to the decision makes it
  // answerable without a debugger.
  debugLog('WorkspaceAppearance', 'edit gate', {
    canEdit,
    workspaceId,
    roleId: state.currentUser?.roleId ?? null,
  });

  const handleSave: (next: WorkspaceTheme) => Promise<void> = useCallback(async (next: WorkspaceTheme): Promise<void> => {
    // Rides in the workspace's metadata bytes, so every member receives it with
    // the workspace they already load. Uses the theme-specific request rather
    // than UpdateWorkspace, which requires the master password.
    //
    // The id is passed explicitly. Omitting it made the server fall back to
    // WORKSPACE_ROOT_ID, while the permission check above runs against THIS
    // workspace — so the owner of a secondary workspace saw an editable editor
    // and a save that was checked against root and denied. The two must name
    // the same domain or the UI is telling the user something the server will
    // not honour.
    if (!workspaceId) {
      throw new Error('Cannot save a workspace theme before the workspace has loaded');
    }
    await WorkspaceService.updateWorkspaceTheme(serializeTheme(next), workspaceId);
  }, [workspaceId]);

  return (
    <div className="space-y-3" data-testid="workspace-appearance-section">
      <div>
        <Label className="text-sm font-medium">Workspace theme</Label>
        <p className="text-xs text-muted-foreground">
          {canEdit
            ? 'The colours everyone in this workspace sees. Your light or dark choice above stays yours.'
            : unchecked
              ? 'Your permissions here could not be checked, so this is read-only for now. Reload to try again.'
              : 'Set by a workspace admin. Your light or dark choice above stays yours.'}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="h-9 w-9 shrink-0 rounded-md border border-border"
          style={{
            background: `linear-gradient(135deg, hsl(${theme.dark.primary.h} ${theme.dark.primary.s}% ${theme.dark.primary.l}%), hsl(${theme.dark.primaryAccent.h} ${theme.dark.primaryAccent.s}% ${theme.dark.primaryAccent.l}%))`,
          }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground" data-testid="current-theme-name">
            {theme.name}
          </p>
          {isDefault && (
            // Distinguishes "the workspace chose Avarok Purple" from "nobody has
            // chosen, so the default is standing in".
            <p className="text-xs text-muted-foreground">Default — not set for this workspace yet</p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          data-testid="open-workspace-appearance"
          onClick={() => setOpen(true)}
        >
          <Palette className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {canEdit ? 'Customise' : 'View'}
        </Button>
      </div>

      {/* Mounted only once opened, so the lazy chunk is fetched on demand. */}
      {open && (
        <Suspense fallback={null}>
          <WorkspaceAppearanceModal
            open={open}
            onOpenChange={setOpen}
            workspaceName={state.workspace?.name ?? 'Workspace'}
            canEdit={canEdit}
            onSave={handleSave}
          />
        </Suspense>
      )}
    </div>
  );
}
