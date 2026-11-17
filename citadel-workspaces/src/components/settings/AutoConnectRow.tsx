/**
 * "Who connects with me automatically": a member's own narrowing of the workspace's messaging
 * trust. It starts as following the workspace and can only be made stricter, which the server
 * enforces; the picker offers only nodes inside the workspace's scope. People outside the
 * resulting scope are governed by "Accept requests from strangers", as before.
 */
import { useState } from 'react';
import { UserCheck } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { getEntityMetadata } from '@/lib/entity-type-registry';
import { messagingTrustApi } from '@/lib/messaging-trust/messaging-trust-api';
import { PERSONAL_TRUST_COPY, TRUST_SECTION_COPY } from '@/lib/messaging-trust/copy';
import {
  inWorkspaceScope, personalChoiceOf, personalPolicyOf, trustedNodeOf, trustNodeOptions,
  type PersonalTrustChoice, type TrustNodeOption,
} from '@/lib/messaging-trust/trust-choice';
import { TrustChoiceGroup } from './TrustChoiceGroup';
import { useMessagingTrust, type MessagingTrustState } from './use-messaging-trust';
import type { DomainNode, MessagingTrustPolicy } from 'citadel-workspace-client-ts';

const CHOICES: readonly PersonalTrustChoice[] = ['follow', 'node', 'ask'];

export function AutoConnectRow(): JSX.Element {
  const { state } = useWorkspace();
  const trust: MessagingTrustState = useMessagingTrust();
  const [pending, setPending] = useState<PersonalTrustChoice | null>(null);
  const workspace: MessagingTrustPolicy | undefined = trust.settings?.workspace;
  const mine: MessagingTrustPolicy | null = trust.settings?.mine ?? null;
  const nodeId: string | null = trustedNodeOf(mine);
  const options: TrustNodeOption[] = workspace === undefined ? [] : trustNodeOptions(state.nodes,
    (id: string): boolean => inWorkspaceScope(state.nodes, workspace, id),
    (node: DomainNode): string => getEntityMetadata(node.entity_type).label);

  const save = (policy: MessagingTrustPolicy | null): void => {
    const _: Promise<boolean> = trust.write(() => messagingTrustApi.setMyPolicy(policy))
      .then((ok: boolean): boolean => { if (ok) setPending(null); return ok; });
  };
  const choose = (choice: PersonalTrustChoice): void => {
    const policy: MessagingTrustPolicy | null | undefined = personalPolicyOf(choice, nodeId);
    if (policy === undefined) setPending(choice);
    else save(policy);
  };

  return (
    <div className="space-y-2 p-3 rounded-lg bg-background/50" data-testid="auto-connect-setting">
      <div className="flex items-start gap-2">
        <UserCheck className="h-4 w-4 mt-0.5 shrink-0 text-primary-accent" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{TRUST_SECTION_COPY.personalTitle}</p>
          <p className="text-xs text-muted-foreground">{TRUST_SECTION_COPY.personalHint}</p>
          {workspace === 'Strict' && <p className="text-xs text-muted-foreground mt-1">{TRUST_SECTION_COPY.workspaceIsStrict}</p>}
        </div>
      </div>
      <TrustChoiceGroup
        id="mine"
        label={TRUST_SECTION_COPY.personalTitle}
        value={pending ?? personalChoiceOf(mine)}
        choices={CHOICES}
        copy={PERSONAL_TRUST_COPY}
        nodeChoice="node"
        nodeOptions={options}
        nodeId={nodeId}
        unavailable={new Set<PersonalTrustChoice>(options.length === 0 ? ['node'] : [])}
        disabled={trust.saving || workspace === undefined}
        onChange={choose}
        onNodeChange={(id: string): void => save({ NodeLevelTrusted: { node_id: id } })}
      />
      {trust.problem && <p role="alert" className="text-sm text-destructive-emphasis">{trust.problem}</p>}
    </div>
  );
}
