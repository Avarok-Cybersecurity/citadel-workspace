/**
 * A control that will not work must say why.
 *
 * Two of the five in-call controls spend real time unavailable: the camera
 * until the call connects, and the screen share for as long as somebody else is
 * sharing. Both were plain `disabled` buttons carrying the title "Screen share
 * off" -- which describes the state the user can already see and not the reason
 * they cannot change it.
 *
 * `disabled` also takes the button out of the tab order and stops it firing
 * mouse events, so the `title` tooltip never appears and a keyboard user cannot
 * reach the control to be told anything at all. The remedy is `aria-disabled`
 * with the click suppressed: the control stays reachable and hoverable, and it
 * announces the reason.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CallControls } from '../CallControls';
import { CallStage } from '../CallStage';

const MEDIA: { audio: boolean; video: boolean; screen: boolean } = {
  audio: true,
  video: false,
  screen: false,
};

function renderControls(
  overrides: Partial<React.ComponentProps<typeof CallControls>> = {},
): { onToggleScreenShare: ReturnType<typeof vi.fn>; onToggleCamera: ReturnType<typeof vi.fn> } {
  const onToggleScreenShare: ReturnType<typeof vi.fn> = vi.fn();
  const onToggleCamera: ReturnType<typeof vi.fn> = vi.fn();
  render(
    <CallControls
      media={MEDIA}
      canToggleVideo
      canToggleMic
      onToggleMic={vi.fn()}
      onToggleCamera={onToggleCamera}
      onToggleScreenShare={onToggleScreenShare}
      canShareScreen
      onLeave={vi.fn()}
      running
      {...overrides}
    />,
  );
  return { onToggleScreenShare, onToggleCamera };
}

describe('an in-call control that cannot be used', () => {
  it('says who is holding the screen instead of just dimming', async () => {
    const { onToggleScreenShare } = renderControls({
      canShareScreen: false,
      shareBlockedReason: 'Ada is sharing — one screen at a time',
    });

    const button: HTMLElement = screen.getByTestId('call-toggle-screen');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Ada is sharing — one screen at a time');
    expect(button).toHaveAttribute('title', 'Ada is sharing — one screen at a time');

    // Reachable, so the reason can actually be read -- and inert, so reaching
    // it cannot start a share that is not allowed.
    expect(button).not.toHaveAttribute('disabled');
    await userEvent.click(button);
    expect(onToggleScreenShare).not.toHaveBeenCalled();
  });

  it('says the camera is waiting on the call rather than nothing', async () => {
    const { onToggleCamera } = renderControls({
      canToggleVideo: false,
      videoBlockedReason: 'Available once the call connects',
    });

    const button: HTMLElement = screen.getByTestId('call-toggle-camera');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Available once the call connects');
    await userEvent.click(button);
    expect(onToggleCamera).not.toHaveBeenCalled();
  });

  it('leaves a usable control alone', async () => {
    const { onToggleScreenShare } = renderControls();

    const button: HTMLElement = screen.getByTestId('call-toggle-screen');
    expect(button).not.toHaveAttribute('aria-disabled', 'true');
    expect(button.getAttribute('aria-label')).toBe('Screen share');
    // The description of a usable control is its state, not a reason it cannot
    // be used -- the `title` carries it, which is what a description is for.
    expect(button).toHaveAccessibleDescription('Screen share off');
    await userEvent.click(button);
    expect(onToggleScreenShare).toHaveBeenCalledTimes(1);
  });

  it('always lets a sharer stop their own share, whatever else is happening', async () => {
    const { onToggleScreenShare } = renderControls({
      media: { ...MEDIA, screen: true },
      canShareScreen: false,
      shareBlockedReason: 'Ada is sharing — one screen at a time',
    });

    const button: HTMLElement = screen.getByTestId('call-toggle-screen');
    expect(button).not.toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(onToggleScreenShare).toHaveBeenCalledTimes(1);
  });
});

/**
 * And the reason has to reach the button from the real stage, or the prop above
 * is a control that operates on nothing: a string nobody passes, tested against
 * a component nobody renders that way.
 */
describe('the stage naming who holds the screen', () => {
  it('tells this tab who is sharing, by name', async (): Promise<void> => {
    // jsdom has no media pipeline, so `play()` returns undefined where a
    // browser returns a promise. Stubbed here rather than guarded in the
    // component: the guard would exist only for this test.
    HTMLMediaElement.prototype.play = (): Promise<void> => Promise.resolve();
    const remote: MediaStream = { getTracks: (): unknown[] => [] } as unknown as MediaStream;

    render(
      <CallStage
        call={{
          callId: 'c1',
          status: 'active',
          home: { kind: 'direct' },
          outgoing: true,
          caller: null,
          selfMedia: { audio: true, video: false, screen: false },
          selfSpeaking: false,
          participants: new Map([[
            2n,
            {
              cid: 2n,
              username: 'Ada Byron',
              status: 'active' as const,
              media: { audio: true, video: false, screen: true },
              speaking: false,
            },
          ]]),
          reason: null,
        }}
        selfUsername="Me"
        localStream={null}
        remoteStreams={new Map<bigint, MediaStream>()}
        remoteScreenStreams={new Map<bigint, MediaStream>([[2n, remote]])}
        onToggleMic={vi.fn()}
        onToggleCamera={vi.fn()}
        onToggleScreenShare={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    const button: HTMLElement = screen.getByTestId('call-toggle-screen');
    expect(button).toHaveAccessibleDescription(/Ada Byron is sharing/);
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });
});
