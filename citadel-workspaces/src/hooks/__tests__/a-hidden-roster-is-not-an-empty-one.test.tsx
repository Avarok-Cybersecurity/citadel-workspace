/**
 * A roster an admin hid reads as hidden, not as "Nobody else is here yet".
 *
 * The server answers `MembersHidden` when "Members can see each other" is off
 * on the node or above it. Real: the response handler, the event bus and the
 * hook. Mocked: only WorkspaceService.listMembers, the network send, which
 * never resolves here so the answer below is the only thing that ends the load.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useDomainMembers, type DomainMembers } from '../use-domain-members';
import { handleGeneratedVariants } from '@/lib/workspace-response-handler/generated-variant-handlers';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

vi.mock('@/lib/workspace-service', (): { default: { listMembers: () => Promise<void> } } => ({
  default: { listMembers: (): Promise<void> => new Promise<void>(() => {}) },
}));

afterEach(cleanup);

function answer(domainId: string): boolean {
  const response: WorkspaceProtocolResponse = { MembersHidden: { domain_id: domainId } };
  return handleGeneratedVariants(response, { cid: 1, request_id: 'r' });
}

describe('a hidden roster', () => {
  it('ends the load and says it is hidden', () => {
    const { result } = renderHook((): DomainMembers => useDomainMembers('office-1'));
    expect(result.current.isLoadingMembers).toBe(true);

    let handled: boolean = false;
    act((): void => { handled = answer('office-1'); });

    expect(handled).toBe(true);
    expect(result.current.membersHidden).toBe(true);
    expect(result.current.isLoadingMembers).toBe(false);
    expect(result.current.membersUnavailable).toBe(false);
    expect(result.current.members).toEqual([]);
  });

  it("is not another node's answer", () => {
    const { result } = renderHook((): DomainMembers => useDomainMembers('office-1'));
    act((): void => { answer('office-2'); });

    expect(result.current.membersHidden).toBe(false);
    expect(result.current.isLoadingMembers).toBe(true);
  });
});
