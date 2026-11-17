/**
 * A question that was never asked is not the answer "no".
 *
 * Round 362 wired the office composer to `Permission.SendMessages`, and got the
 * absent cases right in two places out of three: `loading` (nobody has answered
 * yet) and `unanswered` (the retry budget ran out) both count as allowed.
 *
 * The third was missed. `usePermission(undefined, ...)` returns
 *
 *     { allowed: false, loading: false, unanswered: false }
 *
 * for "there is no domain to ask about" — which is indistinguishable, at the
 * call site, from a real denial. So an office rendered before its node resolved
 * replaced the composer with "You do not have permission to send messages
 * here", blaming the reader's permissions for a question nobody put.
 *
 * `BaseOffice` spells the same convention two files away —
 * `const hasEditPermission = !domainId || canEditMdx` — and this line was
 * written without it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { forgetAllTabs, rememberTab } from '@/lib/node-tabs/tab-memory';

const permission: { allowed: boolean; loading: boolean; unanswered: boolean; answered: boolean } = {
  allowed: false, loading: false, unanswered: false, answered: true,
};

// The restriction the chat is handed is what is under test, not the chat.
vi.mock('../NodeChat', () => ({
  NodeChat: (props: { sendRestriction: string }): JSX.Element => (
    <div data-testid="chat-view" data-restriction={props.sendRestriction} />
  ),
}));
vi.mock('@/components/call/GroupCallControls', () => ({ GroupCallControls: (): JSX.Element => <div /> }));
vi.mock('@/components/call/GroupCallDock', () => ({ GroupCallDock: (): JSX.Element => <div /> }));
vi.mock('@/hooks/use-domain-call-members', () => ({ useDomainCallMembers: (): unknown[] => [] }));
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (nodeId: string | undefined): unknown =>
    // Faithful to the real hook: no domain gives a definite-looking denial.
    nodeId === undefined
      ? { allowed: false, loading: false, unanswered: false, answered: false }
      : permission,
}));

const { ChatTabs } = await import('../tabs/__tests__/doubles/chat-tabs');

function restrictionWith(nodeId: string): string {
  forgetAllTabs();
  // Inactive tab panels do not mount, so the chat panel has to be the open one
  // for there to be anything to assert about.
  rememberTab(nodeId, 'chat');
  const { unmount } = render(<ChatTabs nodeId={nodeId} chatChannelId={`ch-${nodeId}`} contentView={<div />} />);
  const value: string = screen.getByTestId('chat-view').getAttribute('data-restriction') ?? '';
  unmount();
  return value;
}

describe('the office composer', () => {
  // "No domain" no longer reaches the composer: the pane is given the workspace root when the
  // node has none (BaseOffice's `domainId`), and `NodeTabs.nodeId` is a string, so the
  // definite-looking denial `usePermission(undefined, ...)` gives cannot be asked for.

  it('is offered when the permission says yes', () => {
    // The positive control for the test above: a component that always allowed
    // would satisfy it while enforcing nothing.
    permission.allowed = true;
    permission.loading = false;
    permission.unanswered = false;
    permission.answered = true;
    expect(restrictionWith('n1')).toBe('allowed');
  });

  it('is offered when this domain has no stored answer at all', () => {
    // The case that took the composer away for every user in a three-user
    // office run: `hasPermission` returns false for a cache MISS, and nothing
    // at the call site could tell that from a real denial.
    permission.allowed = false;
    permission.loading = false;
    permission.unanswered = false;
    permission.answered = false;
    expect(restrictionWith('n1')).toBe('allowed');
  });

  it('is withheld when the permission actually says no', () => {
    // The other positive control. A real denial, for a domain that answered.
    permission.allowed = false;
    permission.loading = false;
    permission.unanswered = false;
    permission.answered = true;
    expect(restrictionWith('n1')).toBe('denied-by-role');
  });

  it('is offered while the answer is still coming', () => {
    permission.allowed = false;
    permission.loading = true;
    permission.unanswered = false;
    permission.answered = true;
    expect(restrictionWith('n1')).toBe('allowed');
  });

  it('is offered when the request went unanswered', () => {
    permission.allowed = false;
    permission.loading = false;
    permission.unanswered = true;
    permission.answered = true;
    expect(restrictionWith('n1')).toBe('allowed');
  });
});
