/**
 * The loading flags had no writer, so every list rendered its empty state as a
 * statement of fact while its data was still in flight.
 *
 * `emitLoadingEvent` had exactly ONE call site in the codebase — 'workspace:loading'
 * — so `state.loading.nodes` and `state.loading.members` were permanently false.
 * TreeNodesSection's guard is `if (!isLoading && !treeData)`, so every workspace
 * open told the user "Your workspace is empty. Click the + button to create your
 * first space." The "Loading..." arm inside that branch is unreachable by
 * construction, which is exactly why it read as correct.
 *
 * The listeners that LOWER the flags were already there and already correct.
 * Only the raise was missing — the same built-from-one-end shape this campaign
 * keeps finding.
 */
import { describe, it, expect, vi, beforeEach  } from 'vitest';

const emitLoadingEvent: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('@/lib/workspace-response-handler', () => ({
  workspaceResponseHandler: { emitLoadingEvent: (...a: unknown[]): unknown => emitLoadingEvent(...a) },
}));

import { listNodes } from '@/lib/workspace-service/node-operations';
import { listMembers } from '@/lib/workspace-service/member-operations';

const sender: never = { currentCid: 1n, sendProtocolRequest: async (): Promise<undefined> => undefined } as never;

describe('a list request announces that it is loading', () => {
  beforeEach(() => emitLoadingEvent.mockClear());

  it('listNodes emits nodes:loading', async () => {
    await listNodes(sender);
    expect(emitLoadingEvent).toHaveBeenCalledWith('nodes:loading');
  });

  it('listMembers emits members:loading', async () => {
    await listMembers(sender, 'office-1');
    expect(emitLoadingEvent).toHaveBeenCalledWith('members:loading', { domainId: 'office-1' });
  });
});
