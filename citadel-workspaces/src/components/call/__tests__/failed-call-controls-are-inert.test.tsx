/**
 * A call that could not start still shows its stage, so the user can read why
 * and leave. It also showed a live microphone button and a live screen-share
 * button over it.
 *
 * Pressing screen share there opened the browser's screen picker and captured a
 * monitor for a call that did not exist; pressing the mic announced a mute to a
 * peer that was never reached. Only the camera asked whether the call was live
 * — which is what let the other two drift.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CallStage } from '../CallStage';
import type { CallParticipant, CallState, CallStatus } from '@/lib/call/call-state';
import type { CallMediaKinds } from '@/types/p2p-commands';

// jsdom has neither getDisplayMedia nor MediaStreamTrackProcessor, so the share
// button would be disabled for a reason that has nothing to do with the call —
// and the assertion below would hold with the fix removed.
vi.mock('@/lib/call/screen-capability', () => ({ canShareScreen: (): boolean => true }));

const AUDIO_ONLY: CallMediaKinds = { audio: true, video: false, screen: false };
const SHARING: CallMediaKinds = { audio: true, video: false, screen: true };

function participant(): CallParticipant {
  return { cid: 2n, username: 'Bob', status: 'active', media: AUDIO_ONLY, speaking: false };
}

function callState(status: CallStatus, selfMedia: CallMediaKinds = AUDIO_ONLY): CallState {
  return {
    callId: 'c1',
    status,
    selfSpeaking: false,
    home: { kind: 'direct' },
    outgoing: true,
    caller: null,
    selfMedia,
    participants: new Map([[2n, participant()]]),
    reason: status === 'failed' ? 'no UDP channel for peer 372145 within 5s' : null,
  };
}

type StageProps = Omit<React.ComponentProps<typeof CallStage>, 'call'>;

function stageProps(overrides: Partial<StageProps> = {}): StageProps {
  return {
    selfUsername: 'Me',
    localStream: null,
    remoteStreams: new Map<bigint, MediaStream>(),
    onToggleMic: vi.fn(),
    onToggleCamera: vi.fn(),
    onToggleScreenShare: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  };
}

describe('controls on a call that never connected', () => {
  beforeEach((): void => { vi.clearAllMocks(); });

  it('refuses the microphone, and says why', async () => {
    const onToggleMic: ReturnType<typeof vi.fn> = vi.fn();
    render(<CallStage call={callState('failed')} {...stageProps({ onToggleMic })} />);

    const mic: HTMLElement = screen.getByRole('button', { name: 'Microphone' });
    expect(mic).toHaveAttribute('aria-disabled', 'true');
    expect(mic).toHaveAttribute('title', 'The call never connected');
    await userEvent.click(mic);
    expect(onToggleMic).not.toHaveBeenCalled();
  });

  it('refuses to capture a screen for a call that does not exist', async () => {
    const onToggleScreenShare: ReturnType<typeof vi.fn> = vi.fn();
    render(<CallStage call={callState('failed')} {...stageProps({ onToggleScreenShare })} />);

    const share: HTMLElement = screen.getByRole('button', { name: 'Screen share' });
    expect(share).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(share);
    expect(onToggleScreenShare).not.toHaveBeenCalled();
  });

  it('still lets a share of its own be stopped', async () => {
    // The one exception: a screen already captured must always have a control
    // that gives it back, whatever happened to the call underneath it.
    const onToggleScreenShare: ReturnType<typeof vi.fn> = vi.fn();
    render(
      <CallStage call={callState('failed', SHARING)} {...stageProps({ onToggleScreenShare })} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Screen share' }));
    expect(onToggleScreenShare).toHaveBeenCalled();
  });

  it('leaves every control live on a call that is connecting', async () => {
    const onToggleMic: ReturnType<typeof vi.fn> = vi.fn();
    render(<CallStage call={callState('connecting')} {...stageProps({ onToggleMic })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Microphone' }));
    expect(onToggleMic).toHaveBeenCalled();
  });
});
