/**
 * A request refused by the other person's privacy setting says so.
 *
 * The decline travels as the SDK's bare `PeerResponse::Decline`, which carries
 * no reason, so the refusal alone reads like a person saying no. The policy is
 * published on the refusing member's record (`accepts_requests_from_strangers`)
 * for exactly this message.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { PeerRefusalNotice } from '../PeerRefusalNotice';
import { eventEmitter } from '@/lib/event-emitter';
import { WorkspaceContext, useWorkspace } from '@/contexts/WorkspaceContext';
import type { User } from '@/types/workspace-entities';

const toast: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: (): { toast: ReturnType<typeof vi.fn> } => ({ toast }),
}));

afterEach((): void => { cleanup(); toast.mockClear(); });

function Harness({ acceptsRequestsFromStrangers }: { acceptsRequestsFromStrangers: boolean | undefined }): JSX.Element {
  const base: ReturnType<typeof useWorkspace>['state'] = useWorkspace().state;
  const bob: User = {
    id: 'bob', username: 'bob', displayName: 'Bob Brown', isOnline: null,
    createdAt: 0, updatedAt: 0, acceptsRequestsFromStrangers,
  };
  return (
    <WorkspaceContext.Provider value={{ state: { ...base, members: { bob } } }}>
      <PeerRefusalNotice />
    </WorkspaceContext.Provider>
  );
}

function refuse(): void {
  act((): void => {
    eventEmitter.emit('peer-registration:refused', {
      requestId: 'req-9', reason: 'The peer declined the request', peerUsername: 'bob',
    });
  });
}

describe('a refusal from someone who does not accept strangers', () => {
  it('says the refusal is their setting, by name', () => {
    render(<Harness acceptsRequestsFromStrangers={false} />);
    refuse();
    expect(toast.mock.calls[0][0]).toMatchObject({
      title: "Bob Brown isn't accepting messages from people they aren't connected with",
    });
  });

  it('keeps the ordinary wording for someone who accepts strangers', () => {
    // Discrimination: a person who takes requests and said no to this one did
    // exactly that, and must not be reported as a policy.
    render(<Harness acceptsRequestsFromStrangers={true} />);
    refuse();
    expect(toast.mock.calls[0][0]).toMatchObject({ title: 'bob did not accept your request' });
  });

  it('keeps the ordinary wording when no policy is published', () => {
    render(<Harness acceptsRequestsFromStrangers={undefined} />);
    refuse();
    expect(toast.mock.calls[0][0]).toMatchObject({ title: 'bob did not accept your request' });
  });
});
