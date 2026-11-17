/**
 * "Messaging trust", for the workspace: who connects with each other without a request.
 *
 * Everyone (the default the server applies when nothing is stored), one node and below, or
 * nobody. Changes are written as they are picked and the choice shown is the server's answer;
 * the node option waits for a node before it writes. Admins only, which the server enforces.
 */
import { useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { usePermission } from '@/hooks/use-permission';
import { permits } from '@/hooks/use-permission-result';
import { Permission } from '@/lib/permissions-service/types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { getEntityMetadata } from '@/lib/entity-type-registry';
import { messagingTrustApi } from '@/lib/messaging-trust/messaging-trust-api';
import { TRUST_SECTION_COPY, WORKSPACE_TRUST_COPY } from '@/lib/messaging-trust/copy';
import {
  trustedNodeOf, trustNodeOptions, workspaceChoiceOf, workspacePolicyOf, type TrustNodeOption, type WorkspaceTrustChoice,
} from '@/lib/messaging-trust/trust-choice';
import { TrustChoiceGroup } from '@/components/settings/TrustChoiceGroup';
import { useMessagingTrust, type MessagingTrustState } from '@/components/settings/use-messaging-trust';
import type { DomainNode, MessagingTrustPolicy } from 'citadel-workspace-client-ts';

const CHOICES: readonly WorkspaceTrustChoice[] = ['AllTrusted', 'NodeLevelTrusted', 'Strict'];

export function MessagingTrustSection(): JSX.Element {
  const { state } = useWorkspace();
  // EditWorkspaceConfig is what the server asks; this was "Admin" by name, which an Owner is not.
  const admin: boolean = permits(usePermission(WORKSPACE_ROOT_ID, Permission.EditWorkspaceConfig));
  const trust: MessagingTrustState = useMessagingTrust();
  // The node option, picked before its node: shown, not yet written.
  const [pending, setPending] = useState<WorkspaceTrustChoice | null>(null);
  const stored: MessagingTrustPolicy | undefined = trust.settings?.workspace;
  const nodeId: string | null = stored === undefined ? null : trustedNodeOf(stored);
  const options: TrustNodeOption[] = trustNodeOptions(state.nodes, (): boolean => true,
    (node: DomainNode): string => getEntityMetadata(node.entity_type).label);

  const save = (policy: MessagingTrustPolicy): void => {
    const _: Promise<boolean> = trust.write(() => messagingTrustApi.setWorkspacePolicy(policy))
      .then((ok: boolean): boolean => { if (ok) setPending(null); return ok; });
  };
  const choose = (choice: WorkspaceTrustChoice): void => {
    const policy: MessagingTrustPolicy | null = workspacePolicyOf(choice, nodeId);
    if (policy === null) setPending(choice);
    else save(policy);
  };

  return (
    <div className="space-y-2" data-testid="messaging-trust-setting">
      <div className="flex items-start gap-2">
        <MessagesSquare className="h-4 w-4 mt-0.5 shrink-0 text-primary-accent" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{TRUST_SECTION_COPY.workspaceTitle}</p>
          <p className="text-xs text-muted-foreground">{TRUST_SECTION_COPY.workspaceHint}</p>
          {!admin && <p className="text-xs text-muted-foreground mt-1">{TRUST_SECTION_COPY.adminsOnly}</p>}
        </div>
      </div>
      <TrustChoiceGroup
        id="workspace"
        label={TRUST_SECTION_COPY.workspaceTitle}
        value={pending ?? (stored === undefined ? 'AllTrusted' : workspaceChoiceOf(stored))}
        choices={CHOICES}
        copy={WORKSPACE_TRUST_COPY}
        nodeChoice="NodeLevelTrusted"
        nodeOptions={options}
        nodeId={nodeId}
        unavailable={new Set<WorkspaceTrustChoice>(options.length === 0 ? ['NodeLevelTrusted'] : [])}
        disabled={!admin || trust.saving || stored === undefined}
        onChange={choose}
        onNodeChange={(id: string): void => save({ NodeLevelTrusted: { node_id: id } })}
      />
      {trust.problem && <p role="alert" className="text-sm text-destructive-emphasis">{trust.problem}</p>}
    </div>
  );
}
