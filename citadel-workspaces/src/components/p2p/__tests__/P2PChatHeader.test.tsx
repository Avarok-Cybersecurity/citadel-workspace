/**
 * Layout regression: the call buttons drifted into the MIDDLE of the header.
 *
 * The row is `justify-between`, which distributes its direct children. With
 * identity, call buttons and settings as three siblings, the buttons landed
 * centred — visibly wrong, and worse the shorter the peer's name was. They have
 * to sit in one right-hand group with settings so the row has exactly two
 * children to separate.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen , type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { P2PChatHeader } from '../P2PChatHeader';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { PeerPresence } from '@/lib/p2p';

const ONLINE: PeerPresence = { status: MessagingLayerType.Online, lastUpdate: 0 };

const callProps: ComponentProps<typeof P2PChatHeader>['call'] = {
  canCall: true,
  inCall: false,
  capability: { supported: true },
  onStartCall: vi.fn(),
  onLeave: vi.fn(),
};

function renderHeader(): RenderResult {
  return render(
    <P2PChatHeader
      peerName="Alice Chen"
      peerUsername="alice"
      peerPresence={ONLINE}
      peerTyping={false}
      paused={false}
      isConnected
      isRegistered
      connectionRoute={null}
      supervisor={null}
      onSettingsClick={vi.fn()} onOpenFiles={null}
      call={callProps}
    />,
  );
}

describe('P2PChatHeader layout', () => {
  it('keeps the call buttons in the same group as settings', () => {
    renderHeader();

    const audio: HTMLElement = screen.getByTestId('call-start-audio');
    const settings: HTMLElement = screen.getByTestId('chat-settings-button');

    // Sharing an ancestor that is NOT the justify-between row is what puts them
    // together on the right rather than spread across the header.
    expect(audio.closest('div')?.parentElement).toBe(settings.parentElement);
  });

  it('leaves the justify-between row exactly two children to separate', () => {
    const { container } = renderHeader();
    const row: Element | null = container.querySelector('.justify-between');

    expect(row).not.toBeNull();
    expect(row?.children).toHaveLength(2);
  });

  it('truncates a long peer name instead of pushing the actions off screen', () => {
    renderHeader();

    expect(screen.getByRole('heading', { name: 'Alice Chen' }).className).toContain('truncate');
  });
});

describe('the files button', () => {
  it('opens the storage you share once you are registered peers', async () => {
    const onOpenFiles: ReturnType<typeof vi.fn> = vi.fn();
    render(
      <P2PChatHeader peerName="Bob" peerUsername="bob" peerPresence={null} peerTyping={false} paused={false}
        isConnected isRegistered connectionRoute={null} supervisor={null} onSettingsClick={vi.fn()} onOpenFiles={onOpenFiles} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Files shared with Bob' }));
    expect(onOpenFiles).toHaveBeenCalledTimes(1);
  });

  it('says why it is unavailable before then, rather than vanishing', () => {
    render(
      <P2PChatHeader peerName="Bob" peerUsername="bob" peerPresence={null} peerTyping={false} paused={false}
        isConnected={false} isRegistered={false} connectionRoute={null} supervisor={null} onSettingsClick={vi.fn()} onOpenFiles={null} />,
    );
    expect(screen.getByTestId('chat-files-button')).toBeDisabled();
    expect(screen.getByTestId('chat-files-button')).toHaveAccessibleName(/available once you are registered peers/);
  });
});
