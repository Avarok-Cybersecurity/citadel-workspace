/**
 * The chat header says whether messages go straight to the peer or through a relay.
 *
 * A peer connection is delivered at once over the server relay and may go
 * direct later, so "Relayed" is the normal first state, not a failure: its
 * tooltip says a direct connection is being set up. A relay that will stay
 * names the relay instead.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { P2PChatHeader } from '../P2PChatHeader';
import { CONNECTION_PATH_COPY } from '@/lib/ice-servers/path-copy';
import { CHAT_PATH_COPY, chatPathLabel } from '@/lib/ice-servers/chat-path-copy';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { PeerPathReport } from '@/types/ice-servers';

afterEach(cleanup);

function renderHeader(route: PeerPathReport | null, opts: { connected?: boolean; paused?: boolean } = {}): void {
  render(
    <P2PChatHeader
      peerName="ada" peerUsername="ada" peerPresence={{ status: MessagingLayerType.Online, lastUpdate: 0 }} peerTyping={false}
      isConnected={opts.connected ?? true} isRegistered paused={opts.paused ?? false}
      connectionRoute={route} supervisor={null} onSettingsClick={vi.fn()} onOpenFiles={null}
    />,
  );
}

describe('the chat header path label', () => {
  it.each([
    [{ path: 'direct', upgrading: false }, 'Direct', null],
    [{ path: 'server_relay', upgrading: true }, 'Relayed', CHAT_PATH_COPY.upgrading],
    [{ path: 'turn', upgrading: true }, 'Relayed', CHAT_PATH_COPY.upgrading],
    [{ path: 'server_relay', upgrading: false }, 'Relayed', CONNECTION_PATH_COPY.server_relay],
    [{ path: 'turn', upgrading: false }, 'Relayed', CONNECTION_PATH_COPY.turn],
  ] as const)('reads %o as %s', (route: PeerPathReport, text: string, tooltip: string | null) => {
    expect(chatPathLabel(route, null)).toEqual({ text, tooltip, direct: route.path === 'direct' });
  });

  it('says nothing when no path has been reported', () => {
    expect(chatPathLabel(null, null)).toBeNull();
  });

  it('shows "Direct" with no explanation to hover for', () => {
    renderHeader({ path: 'direct', upgrading: false });
    const label: HTMLElement = screen.getByTestId('chat-connection-path');
    expect(label.textContent).toBe('Direct');
    expect(label.dataset.direct).toBe('true');
    expect(label.closest('button')).toBeNull();
  });

  it('shows "Relayed", and explains it to a keyboard user as well as on hover', async (): Promise<void> => {
    renderHeader({ path: 'server_relay', upgrading: true });
    const label: HTMLElement = screen.getByTestId('chat-connection-path');
    expect(label.textContent).toBe('Relayed');
    expect(label.dataset.direct).toBe('false');

    await userEvent.tab();
    const trigger: Element | null = label.closest('button');
    expect(trigger).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger?.getAttribute('aria-label')).toBe(`Relayed: ${CHAT_PATH_COPY.upgrading}`);
    expect((await screen.findByRole('tooltip')).textContent).toContain(CHAT_PATH_COPY.upgrading);
  });

  it('is not shown while the link is down or paused, when a path would be stale', () => {
    renderHeader({ path: 'direct', upgrading: false }, { connected: false });
    expect(screen.queryByTestId('chat-connection-path')).toBeNull();
    cleanup();
    renderHeader({ path: 'direct', upgrading: false }, { paused: true });
    expect(screen.queryByTestId('chat-connection-path')).toBeNull();
  });
});
