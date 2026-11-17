/**
 * The waiting states: who is being called, how to stop calling them, and the
 * bridge between accepting and the first frame. These are the moments the
 * user decides whether the feature works.
 */
import type { ComponentProps } from 'react';
import { describe, it, expect, vi  } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CallStage } from '../CallStage';
import { IncomingCallCard } from '../IncomingCallCard';
import type { CallParticipant, CallState } from '@/lib/call/call-state';
import type { CallMediaKinds } from '@/types/p2p-commands';

const AUDIO_ONLY: CallMediaKinds = { audio: true, video: false, screen: false };

function participant(overrides: Partial<CallParticipant> = {}): CallParticipant {
  return {
    cid: 2n,
    username: 'Bob Kade',
    status: 'invited',
    media: AUDIO_ONLY,
    speaking: false,
    ...overrides,
  };
}

function callState(overrides: Partial<CallState> = {}): CallState {
  return {
    callId: 'c1',
    status: 'ringing-out',
    home: { kind: 'direct' },
    outgoing: true,
    caller: null,
    selfMedia: AUDIO_ONLY,
    selfSpeaking: false,
    participants: new Map([[2n, participant()]]),
    reason: null,
    ...overrides,
  };
}

const stageProps: Omit<ComponentProps<typeof CallStage>, 'call'> = {
  selfUsername: 'Me',
  localStream: null,
  remoteStreams: new Map<bigint, MediaStream>(),
  onToggleMic: vi.fn(),
  onToggleCamera: vi.fn(),
  onLeave: vi.fn(),
};

describe('CallStage outgoing-call panel', () => {
  it('shows who is being called, by name and avatar initials', () => {
    render(<CallStage call={callState()} {...stageProps} />);

    expect(screen.getByText('Calling Bob Kade…')).toBeInTheDocument();
    expect(screen.getByText('BK')).toBeInTheDocument();
  });

  it('offers a Cancel that hangs up', async () => {
    const onLeave: ReturnType<typeof vi.fn> = vi.fn();
    render(<CallStage call={callState()} {...stageProps} onLeave={onLeave} />);

    await userEvent.click(screen.getByTestId('call-cancel'));

    expect(onLeave).toHaveBeenCalled();
  });

  it('counts the others in a group ring', () => {
    const call: CallState = callState({
      participants: new Map([
        [2n, participant()],
        [3n, participant({ cid: 3n, username: 'Carol' })],
      ]),
    });
    render(<CallStage call={call} {...stageProps} />);

    expect(screen.getByText('Calling Bob Kade and 1 more…')).toBeInTheDocument();
    expect(screen.getByText('Waiting for 2 people to answer.')).toBeInTheDocument();
  });

  it('announces politely rather than as an alert', () => {
    render(<CallStage call={callState()} {...stageProps} />);

    expect(screen.getByTestId('call-ringing')).toHaveAttribute('role', 'status');
  });

  it('keeps the pulsing halo behind motion-safe so reduced motion gets a static ring', () => {
    // Guards the CSS contract: without motion-safe:, prefers-reduced-motion
    // users would get the animation Tailwind cannot conditionally remove.
    const { container } = render(<CallStage call={callState()} {...stageProps} />);

    const halos: ReturnType<typeof container.querySelectorAll> = container.querySelectorAll('.motion-safe\\:animate-ring-pulse');
    expect(halos.length).toBeGreaterThan(0);
    expect(container.querySelector('[class*="animate-ring-pulse"]:not([class*="motion-safe"])')).toBeNull();
  });
});

describe('CallStage connecting state', () => {
  it('shows a connecting indicator between accept and the first frame', () => {
    render(<CallStage call={callState({ status: 'connecting' })} {...stageProps} />);

    const banner: HTMLElement = screen.getByTestId('call-connecting');
    expect(banner).toHaveAttribute('role', 'status');
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    // The participants grid renders behind it: never a dead-looking gap.
    expect(screen.getByTestId('call-participants')).toBeInTheDocument();
  });

  it('drops the indicator once the call is active', () => {
    render(<CallStage call={callState({ status: 'active' })} {...stageProps} />);

    expect(screen.queryByTestId('call-connecting')).not.toBeInTheDocument();
  });
});

describe('IncomingCallCard ringing treatment', () => {
  it('animates only under motion-safe', () => {
    const { container } = render(
      <IncomingCallCard callerName="Alice Chen" media={AUDIO_ONLY} onAccept={vi.fn()} onDecline={vi.fn()} />,
    );

    expect(container.querySelectorAll('.motion-safe\\:animate-ring-pulse').length).toBeGreaterThan(0);
    expect(container.querySelector('[class*="animate-"]:not([class*="motion-safe"])')).toBeNull();
  });
});
