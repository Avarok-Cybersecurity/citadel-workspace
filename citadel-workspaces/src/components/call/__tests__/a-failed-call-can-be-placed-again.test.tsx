/**
 * A failed call offers a way out: Try again places the same call (same people, same home, video
 * only if this side had it). It used to show a title and a detail with nothing to press.
 */
import type { ComponentProps } from 'react';
import { describe, it, expect, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CallStage } from '../CallStage';
import { callAgainOf, type CallAgain } from '@/lib/call/call-again';
import type { CallParticipant, CallState } from '@/lib/call/call-state';
import type { CallMediaKinds } from '@/types/p2p-commands';

const AUDIO_ONLY: CallMediaKinds = { audio: true, video: false, screen: false };
const UDP: string = 'no UDP channel for peer 2181040939592097811 within 5s';

const bob: CallParticipant = { cid: 2n, username: 'bob', status: 'invited', media: AUDIO_ONLY, speaking: false };

function failed(participants: Map<bigint, CallParticipant>): CallState {
  return {
    callId: 'c1', status: 'failed', home: { kind: 'group', roomId: 'r1' }, outgoing: true, caller: null,
    selfMedia: AUDIO_ONLY, selfSpeaking: false, participants, reason: UDP,
  };
}

const stageProps: Omit<ComponentProps<typeof CallStage>, 'call'> = {
  selfUsername: 'Me', localStream: null, remoteStreams: new Map<bigint, MediaStream>(),
  onToggleMic: vi.fn(), onToggleCamera: vi.fn(), onLeave: vi.fn(),
};

describe('a failed call', () => {
  it('Try again places it again, and the raw reason stays for support', async () => {
    const again: Mock<() => Promise<void>> = vi.fn(async (): Promise<void> => undefined);
    render(<CallStage call={failed(new Map([[2n, bob]]))} {...stageProps} onCallAgain={again} />);
    expect(screen.getByTestId('call-error').getAttribute('data-raw-reason')).toBe(UDP);
    expect(screen.getByTestId('recovery-call.failed').textContent ?? '').not.toContain('2181040939592097811');
    await userEvent.click(screen.getByTestId('recovery-control-retry'));
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('places the same people in the same home, without video it did not have', () => {
    const plan: CallAgain | null = callAgainOf(failed(new Map([[2n, bob]])));
    expect(plan).toEqual({ peers: [{ cid: 2n, username: 'bob' }], video: false, home: { kind: 'group', roomId: 'r1' } });
  });

  it('knows nobody to call: nothing is offered', () => {
    expect(callAgainOf(failed(new Map()))).toBeNull();
  });
});
