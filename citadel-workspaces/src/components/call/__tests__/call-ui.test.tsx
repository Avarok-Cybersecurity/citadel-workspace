/**
 * The states covered here are the ones a call product is judged on: a camera
 * that is off, a peer who is muted, a call that failed, a call still ringing.
 * Each looks broken if it renders as nothing.
 */
import type { ComponentProps } from 'react';
import { describe, it, expect, vi  } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ParticipantTile } from '../ParticipantTile';
import { CallControls } from '../CallControls';
import { IncomingCallCard } from '../IncomingCallCard';
import { CallStage } from '../CallStage';
import { CallEntryButtons } from '../CallEntryButtons';
import type { CallParticipant, CallState } from '@/lib/call/call-state';
import type { CallMediaKinds } from '@/types/p2p-commands';

const AUDIO_ONLY: CallMediaKinds = { audio: true, video: false, screen: false };
const VIDEO: CallMediaKinds = { audio: true, video: true, screen: false };
const MUTED: CallMediaKinds = { audio: false, video: true, screen: false };

function participant(overrides: Partial<CallParticipant> = {}): CallParticipant {
  return {
    cid: 2n,
    username: 'Bob Kade',
    status: 'active',
    media: VIDEO,
    speaking: false,
    ...overrides,
  };
}

function callState(overrides: Partial<CallState> = {}): CallState {
  return {
    callId: 'c1',
    status: 'active',
    home: { kind: 'direct' },
    outgoing: true,
    caller: null,
    selfMedia: VIDEO,
    selfSpeaking: false,
    participants: new Map([[2n, participant()]]),
    reason: null,
    ...overrides,
  };
}

describe('ParticipantTile', () => {
  it('shows an avatar rather than an empty box when the camera is off', () => {
    // The avatar is the default and video the enhancement: a tile that waits
    // for a stream flashes black exactly when the user is deciding whether the
    // call worked.
    render(<ParticipantTile participant={participant({ media: AUDIO_ONLY })} stream={null} isSelf={false} />);

    expect(screen.getByText('BK')).toBeInTheDocument();
  });

  it('shows an avatar when video is on but no stream has arrived yet', () => {
    render(<ParticipantTile participant={participant()} stream={null} isSelf={false} />);

    expect(screen.getByText('BK')).toBeInTheDocument();
  });

  it('announces a muted peer in text, not just an icon', () => {
    render(<ParticipantTile participant={participant({ media: MUTED })} stream={null} isSelf={false} />);

    expect(screen.getByText('muted')).toBeInTheDocument();
  });

  it('pairs the speaking ring with a non-colour cue', () => {
    // Colour alone carrying meaning fails WCAG 1.4.1.
    render(<ParticipantTile participant={participant({ speaking: true })} stream={null} isSelf={false} />);

    expect(screen.getByText('speaking')).toBeInTheDocument();
  });

  it('labels our own tile "You"', () => {
    render(<ParticipantTile participant={participant()} stream={null} isSelf />);

    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByText('Bob Kade')).not.toBeInTheDocument();
  });

  it('says nothing about connection quality while it is good', () => {
    render(<ParticipantTile participant={participant()} stream={null} isSelf={false} quality="good" />);

    expect(screen.queryByTestId('participant-quality-2')).not.toBeInTheDocument();
  });

  it('describes a degraded connection in text', () => {
    render(<ParticipantTile participant={participant()} stream={null} isSelf={false} quality="poor" />);

    expect(screen.getByText('Poor connection')).toBeInTheDocument();
  });
});

describe('CallControls', () => {
  const noop = (): void => {};

  it('names the microphone once and lets aria-pressed carry the state', async () => {
    // This test used to assert the opposite, and moved with the bug: it
    // required the label to FLIP with the state, beside an aria-pressed that
    // also flips. Paired, they contradict — "Mute microphone, pressed"
    // announces as *muted* while the microphone is live, which on a privacy
    // control is the worst possible direction to be wrong in.
    const onToggleMic: ReturnType<typeof vi.fn> = vi.fn();
    const { rerender } = render(
      <CallControls media={VIDEO} canToggleVideo canToggleMic onToggleMic={onToggleMic} onToggleCamera={noop} onLeave={noop} running={false} />,
    );

    const mic: HTMLElement = screen.getByRole('button', { name: 'Microphone' });
    expect(mic).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(mic);
    expect(onToggleMic).toHaveBeenCalled();

    rerender(
      <CallControls media={MUTED} canToggleVideo canToggleMic onToggleMic={onToggleMic} onToggleCamera={noop} onLeave={noop} running={false} />,
    );

    // Same name, different state. That is the whole contract.
    expect(screen.getByRole('button', { name: 'Microphone' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('keeps Leave available even while connecting', () => {
    // Being unable to abandon a call that is still connecting is the worst
    // version of this component.
    render(
      <CallControls media={AUDIO_ONLY} canToggleVideo={false} canToggleMic={false} micBlockedReason="Available once the call connects" onToggleMic={noop} onToggleCamera={noop} onLeave={noop} running={false} />,
    );

    expect(screen.getByRole('button', { name: /leave/i })).toBeEnabled();
  });

  it('hides the timer from screen readers', () => {
    // Announcing it every second would make the call unusable with a reader.
    render(
      <CallControls media={VIDEO} canToggleVideo canToggleMic onToggleMic={noop} onToggleCamera={noop} onLeave={noop} running={false} />,
    );

    expect(screen.getByTestId('call-duration')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('IncomingCallCard', () => {
  it('names the caller and the kind of call', () => {
    render(<IncomingCallCard callerName="Alice Chen" media={VIDEO} onAccept={vi.fn()} onDecline={vi.fn()} />);

    expect(screen.getByText('Alice Chen')).toBeInTheDocument();
    expect(screen.getByText(/incoming video call/i)).toBeInTheDocument();
  });

  it('names the room for a group call', () => {
    render(
      <IncomingCallCard callerName="Alice Chen" media={AUDIO_ONLY} roomName="design-review" onAccept={vi.fn()} onDecline={vi.fn()} />,
    );

    expect(screen.getByText(/design-review/)).toBeInTheDocument();
  });

  it('puts Decline before Accept in DOM order', async () => {
    // Visually Accept is the primary action on the right, but a Tab-then-Enter
    // reflex must not answer a call by accident.
    render(<IncomingCallCard callerName="Alice" media={VIDEO} onAccept={vi.fn()} onDecline={vi.fn()} />);

    const buttons: HTMLElement[] = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('data-testid', 'incoming-call-decline');
  });

  it('offers answering a video call without video', async () => {
    const onAccept: ReturnType<typeof vi.fn> = vi.fn();
    render(<IncomingCallCard callerName="Alice" media={VIDEO} onAccept={onAccept} onDecline={vi.fn()} />);

    await userEvent.click(screen.getByTestId('incoming-call-accept-audio'));

    expect(onAccept).toHaveBeenCalledWith({ audio: true, video: false, screen: false });
  });

  it('does not offer that on an audio call, where it would mean nothing', () => {
    render(<IncomingCallCard callerName="Alice" media={AUDIO_ONLY} onAccept={vi.fn()} onDecline={vi.fn()} />);

    expect(screen.queryByTestId('incoming-call-accept-audio')).not.toBeInTheDocument();
  });
});

describe('CallStage', () => {
  const props: Omit<ComponentProps<typeof CallStage>, 'call'> = {
    selfUsername: 'Me',
    localStream: null,
    remoteStreams: new Map<bigint, MediaStream>(),
    onToggleMic: vi.fn(),
    onToggleCamera: vi.fn(),
    onLeave: vi.fn(),
  };

  it('renders a tile for each participant plus ourselves', () => {
    render(<CallStage call={callState()} {...props} />);

    expect(screen.getByTestId('participant-tile-2')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('shows the speaking ring on your own tile', () => {
    // The last hop of the indicator, and the one that stayed broken longest.
    // The stage synthesises the self tile rather than reading it from
    // `participants`, and it passed a literal `speaking: false` -- so detection,
    // dispatch and reducer could all be correct and the ring still never
    // appear. Reverting that literal must fail HERE; nothing else can see it.
    render(<CallStage call={callState({ selfSpeaking: true, selfMedia: AUDIO_ONLY })} {...props} />);

    const selfTile: HTMLElement = screen.getByTestId('participant-tile-self');
    expect(
      selfTile.textContent,
      'the self tile ignored state.selfSpeaking',
    ).toContain('speaking');
  });

  it('does not show it when you are silent', () => {
    render(<CallStage call={callState({ selfSpeaking: false, selfMedia: AUDIO_ONLY })} {...props} />);

    const selfTile: HTMLElement = screen.getByTestId('participant-tile-self');
    expect(selfTile.textContent, 'a silent tile claimed to be speaking').not.toContain('speaking');
  });

  it('names your own tile for what it is, not for a sentinel CID', () => {
    // The stage synthesises self with `cid: -1n`, so the testid was
    // `participant-tile--1` and two Playwright specs filtered on that string to
    // count REMOTE videos. A magic number in the DOM that tests must know about
    // is a workaround wearing an identifier's clothes.
    render(<CallStage call={callState()} {...props} />);

    expect(screen.getByTestId('participant-tile-self')).toBeInTheDocument();
    expect(screen.queryByTestId('participant-tile--1')).not.toBeInTheDocument();
  });

  it('shows a ringing state rather than an empty grid before anyone answers', () => {
    render(<CallStage call={callState({ status: 'ringing-out' })} {...props} />);

    expect(screen.getByTestId('call-ringing')).toBeInTheDocument();
    expect(screen.queryByTestId('call-participants')).not.toBeInTheDocument();
  });

  it('explains a failure instead of showing a dead call surface', () => {
    render(
      <CallStage call={callState({ status: 'failed', reason: 'this peer connected without UDP' })} {...props} />,
    );

    const error: HTMLElement = screen.getByTestId('call-error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(screen.getByText(/without UDP/)).toBeInTheDocument();
  });

  it('omits participants who declined or left', () => {
    const call: CallState = callState({
      participants: new Map([
        [2n, participant()],
        [3n, participant({ cid: 3n, username: 'Carol', status: 'declined' })],
      ]),
    });
    render(<CallStage call={call} {...props} />);

    expect(screen.getByTestId('participant-tile-2')).toBeInTheDocument();
    expect(screen.queryByTestId('participant-tile-3')).not.toBeInTheDocument();
  });

  it('describes the call for assistive technology', () => {
    const call: CallState = callState({
      participants: new Map([
        [2n, participant()],
        [3n, participant({ cid: 3n, username: 'Carol' })],
      ]),
    });
    render(<CallStage call={call} {...props} />);

    expect(screen.getByRole('region', { name: /call in progress with 2 people/i })).toBeInTheDocument();
  });
});

describe('CallEntryButtons', () => {
  const supported: { supported: boolean; } = { supported: true };

  it('offers audio and video separately', async () => {
    const onStartCall: ReturnType<typeof vi.fn> = vi.fn();
    render(
      <CallEntryButtons targetName="Alice" canCall inCall={false} capability={supported} onStartCall={onStartCall} onLeave={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /start audio call with alice/i }));
    expect(onStartCall).toHaveBeenCalledWith(false);

    await userEvent.click(screen.getByRole('button', { name: /start video call with alice/i }));
    expect(onStartCall).toHaveBeenCalledWith(true);
  });

  it('stays visible but disabled when the peer is offline, rather than vanishing', () => {
    // A control that disappears teaches the user the feature does not exist;
    // one that explains itself teaches them what to fix.
    render(
      <CallEntryButtons targetName="Alice" canCall={false} inCall={false} capability={supported} onStartCall={vi.fn()} onLeave={vi.fn()} />,
    );

    expect(screen.getByTestId('call-unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^call alice$/i })).toBeDisabled();
  });

  it('is disabled with the browser’s own reason when calls are unsupported', () => {
    render(
      <CallEntryButtons
        targetName="Alice"
        canCall
        inCall={false}
        capability={{ supported: false, reason: 'This browser does not support WebCodecs, which calls require.' }}
        onStartCall={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    expect(screen.getByTestId('call-unavailable')).toBeInTheDocument();
  });

  it('replaces both buttons with a single leave control during a call', async () => {
    // Offering "call" during a call is how people start a second one by mistake.
    const onLeave: ReturnType<typeof vi.fn> = vi.fn();
    render(
      <CallEntryButtons targetName="Alice" canCall inCall capability={supported} onStartCall={vi.fn()} onLeave={onLeave} />,
    );

    expect(screen.queryByTestId('call-start-audio')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /leave call with alice/i }));
    expect(onLeave).toHaveBeenCalled();
  });
});
