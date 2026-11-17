/**
 * PermissionsSettingsTab Component
 *
 * Displays user permissions across all domains (workspace, offices, rooms)
 * in a nested accordion structure with permission tables.
 */

import { useState, useEffect, useMemo } from 'react';
import { Loader2, CheckCircle2, XCircle, Building2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { usePermissions } from '@/contexts/PermissionsContext';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { permissionSections, type PermissionSection } from './permission-sections';
import { RoleBadge, GroupedPermissionTable } from './PermissionWidgets';
import { ParentNodePermissionSection } from './PermissionNodeSections';

/**
 * Main PermissionsSettingsTab component
 */
export function PermissionsSettingsTab(): JSX.Element {
  const { state } = useWorkspace();
  const {
    loading,
    error,
    refreshPermissions,
    fetchPermissionsForDomain,
  } = usePermissions();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const workspaceId: string | undefined = state.workspace?.id;
  const workspaceName: string = state.workspace?.name || 'Workspace';

  // Fetch workspace permissions on mount
  useEffect(() => {
    if (workspaceId) {
      runAsyncSetup(async () => {
        await fetchPermissionsForDomain(workspaceId);
      });
    }
  }, [workspaceId, fetchPermissionsForDomain]);

  const nodesWithChildren: PermissionSection[] = useMemo((): PermissionSection[] => permissionSections(Object.values(state.nodes)), [state.nodes]);

  const handleRefresh = async (): Promise<void> => {
    setIsRefreshing(true);
    await refreshPermissions();
    setIsRefreshing(false);
  };

  if (!workspaceId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Building2 className="h-12 w-12 mb-4 opacity-50" />
        <p>No workspace loaded</p>
        <p className="text-sm text-muted-foreground mt-1">Join a workspace to view your permissions</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <XCircle className="h-12 w-12 text-destructive mb-4" />
        <p className="text-destructive-emphasis">Failed to load permissions</p>
        <p className="text-sm text-muted-foreground mt-1">{error}</p>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="mt-4">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-medium text-foreground">Your Permissions</h3>
          <p className="text-sm text-muted-foreground mt-1">View your access rights across all domains</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing || loading}
          className="text-muted-foreground border-border hover:bg-accent"
        >
          {isRefreshing || loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {/* Nested Permission Tree */}
      <Accordion type="multiple" defaultValue={[`workspace-${workspaceId}`]} className="w-full">
        <AccordionItem value={`workspace-${workspaceId}`} className="border-border">
          <AccordionTrigger className="text-foreground hover:text-foreground hover:no-underline">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-primary-accent" />
              <span className="font-medium">{workspaceName}</span>
              <RoleBadge />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pl-2 space-y-4">
              <div className="mb-4">
                <GroupedPermissionTable domainId={workspaceId} />
              </div>

              {nodesWithChildren.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">Nodes</h4>
                  <Accordion type="multiple" className="w-full">
                    {nodesWithChildren.map((node) => (
                      <ParentNodePermissionSection
                        key={node.id}
                        nodeId={node.id}
                        nodeName={node.name}
                        entityType={node.entityType}
                        children={node.children}
                      />
                    ))}
                  </Accordion>
                </div>
              )}

              {nodesWithChildren.length === 0 && (
                <p className="text-sm text-muted-foreground italic pl-2">No nodes in this workspace</p>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Legend */}
      <div className="border-t border-border pt-4">
        <p className="text-xs text-muted-foreground mb-2">Legend</p>
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-success-emphasis" />
            <span className="text-muted-foreground">Allowed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5 text-destructive" />
            <span className="text-muted-foreground">Denied</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-primary-accent" />
            <span className="text-muted-foreground">Workspace</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PermissionsSettingsTab;
