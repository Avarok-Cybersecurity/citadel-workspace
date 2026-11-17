/**
 * A removed account is told it was refused, not shown a spinner for ever.
 *
 * CI run 43918454602: an administrator removed an account, which then reloaded. The kernel kept
 * the removal and refused it the node list ("Failed to list nodes: Permission denied: Not a member
 * of this workspace"), the members and the roles; its GetWorkspace came back as
 * WorkspaceNotInitialized. With no workspace record, the loader held the whole app behind "Workspace
 * data is taking longer than expected..." for the full minute the spec waited.
 *
 * The refusal is read as the kernel emits it: these tests take the wording from the kernel's own
 * sources, so a rewording there goes red here rather than silently restoring the spinner.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { handleWorkspaceVariants, buildConnectionInfo } from '@/lib/workspace-response-handler/workspace-handlers';
import { NOT_A_MEMBER, isMembershipRefusal } from '@/lib/membership-refusal';
import { loaderView, type LoaderInputs } from '@/components/ui/workspace-loader-state';
import { useMessageEventSetup } from '../useMessageEventSetup';
import type { WorkspaceEventState } from '../../WorkspaceEventHandler';

const KERNEL: string = resolve(__dirname, '../../../../../citadel-workspace-server-kernel/src');

function kernelSource(path: string): string {
  return readFileSync(resolve(KERNEL, path), 'utf8');
}

/** The node list's refusal, as the command processor wraps the node ops' error. */
function kernelListNodesRefusal(): string {
  const nodeOps: string = kernelSource('handlers/domain/async_ops/async_node_ops/mod.rs');
  const reason: RegExpMatchArray | null = nodeOps.match(/is_member_of_domain\(user_id, crate::WORKSPACE_ROOT_ID\)[\s\S]*?NetworkError::msg\(\s*"([^"]+)"/);
  if (reason === null) throw new Error('async_node_ops no longer refuses a non-member of the root with a literal');
  const processor: string = kernelSource('kernel/command_processor/async_process_command.rs');
  if (!processor.includes('"Failed to list nodes: {}"')) throw new Error('ListNodes no longer wraps its error as "Failed to list nodes: {}"');
  return `Failed to list nodes: ${reason[1]}`;
}

function harness(): { state: () => Partial<WorkspaceEventState> } {
  let current: Partial<WorkspaceEventState> = { membershipRefused: false };
  const setState = (update: unknown): void => {
    current = typeof update === 'function'
      ? (update as (p: Partial<WorkspaceEventState>) => Partial<WorkspaceEventState>)(current)
      : (update as Partial<WorkspaceEventState>);
  };
  renderHook(() => useMessageEventSetup({ setState: setState as never }));
  return { state: (): Partial<WorkspaceEventState> => current };
}

/** The loader as the CI page had it: connected, no workspace record, data timed out. */
const STUCK: LoaderInputs = {
  isLoading: true,
  isAutoClaiming: false,
  loadingTimeout: false,
  hasConnection: true,
  workspaceDataTimeout: true,
  heldElsewhere: false,
  reconnectingTo: null,
  keptTree: false,
  keptTreeLocked: false,
  refused: false,
};

describe('a removed account', () => {
  it('reads the kernel’s own constant', () => {
    const errors: string = kernelSource('handlers/domain/workspace_errors.rs');
    expect(errors).toContain(`pub const NOT_A_MEMBER: &str = "${NOT_A_MEMBER}";`);
    expect(isMembershipRefusal(kernelListNodesRefusal())).toBe(true);
  });

  it('is marked refused when the server refuses it the node list', async () => {
    const h: ReturnType<typeof harness> = harness();
    await waitFor((): void => {
      act((): void => { handleWorkspaceVariants({ Error: kernelListNodesRefusal() }, buildConnectionInfo()); });
      expect(h.state().membershipRefused).toBe(true);
    });
  });

  it('is not marked refused by another refusal', async () => {
    // The control: a member refused one domain's roster is still a member of the workspace.
    const h: ReturnType<typeof harness> = harness();
    await waitFor((): void => {
      act((): void => { handleWorkspaceVariants({ Error: 'Permission denied: not a member of this domain' }, buildConnectionInfo()); });
      expect(h.state().error).toBe('Permission denied: not a member of this domain');
    });
    expect(h.state().membershipRefused).toBe(false);
  });

  it('is shown the refusal instead of the spinner', () => {
    expect(loaderView(STUCK)).toEqual({ kind: 'spinner', message: 'Workspace data is taking longer than expected...', showConnectButton: true });
    expect(loaderView({ ...STUCK, refused: true })).toEqual({ kind: 'refused' });
  });
});
