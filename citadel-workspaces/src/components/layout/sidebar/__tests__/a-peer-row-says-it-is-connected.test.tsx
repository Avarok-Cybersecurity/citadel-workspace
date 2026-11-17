/**
 * A peer's row must be findable by name and must say its own status.
 *
 * `connectP2P` verified a connection by walking into a sidebar section headed
 * "CONNECTED PEERS" and looking for the peer inside it. That heading was
 * deliberately removed: the members list called itself "Workspace Members",
 * "Connected Peers" or "<Entity> Members" depending on state the user could not
 * see, and was given one noun. From that day the locator matched nothing, the
 * check could never pass, and every P2P connection was reported as
 *
 *   FAIL: P2P connect to X sent, but the peer never appeared as connected
 *
 * which reads as a protocol failure and is a heading that changed. It is the
 * only verification that function has.
 *
 * The row's own status text is what the helper reads now — the same string a
 * screen reader is given, so the check and the accessibility affordance stand
 * or fall together.
 *
 * Both inputs later gained a third value. `isOnline` came from a poll set that
 * is empty before the first refresh, so every peer read "Offline" until it
 * landed; `isConnected` came from `Promise.race([check, timeoutAfter(1000)])`
 * with the timeout resolving `false`, which is a stopwatch rather than an
 * answer — a connected peer whose check was slow rendered as merely online.
 * Null now gets its own words instead of borrowing the negative's.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { PeerListRow } from '../PeerListRow';

function renderRow(isConnected: boolean | null, isOnline: boolean | null): void {
  render(
    <SidebarProvider>
      <PeerListRow
        cid="42"
        username="ada"
        displayName="ada"
        isOnline={isOnline}
        isConnected={isConnected}
        connectionPath={null}
        onClick={vi.fn()}
      />
    </SidebarProvider>,
  );
}

describe('a peer row', () => {
  it('is addressable by the peer’s name and says Connected', () => {
    renderRow(true, true);

    const row: HTMLElement = screen.getByTestId('peer-row-ada');
    expect(row).toBeInTheDocument();
    expect(row.textContent ?? '').toContain('Connected');
  });

  it('does not say Connected when it is merely online', () => {
    // The positive control. Without it, "the row says Connected" is satisfied
    // by a row that says it unconditionally — and the helper would then report
    // every attempt as a success, which is the mirror of the bug it replaced.
    renderRow(false, true);

    const row: HTMLElement = screen.getByTestId('peer-row-ada');
    expect(row.textContent ?? '').toContain('Online');
    expect(row.textContent ?? '').not.toContain('Connected');
  });

  it('says Offline when it is neither', () => {
    renderRow(false, false);
    expect(screen.getByTestId('peer-row-ada').textContent ?? '').toContain('Offline');
  });

  it('does not say Offline for a peer nobody has polled yet', () => {
    renderRow(false, null);

    const row: HTMLElement = screen.getByTestId('peer-row-ada');
    expect(row.textContent ?? '').not.toContain('Offline');
    expect(row.textContent ?? '').toMatch(/not known/i);
  });

  it('does not claim a peer is merely online when the check timed out', () => {
    // The connection check did not finish. It has not reported "not connected",
    // and the row used to say so anyway.
    renderRow(null, true);
    expect(screen.getByTestId('peer-row-ada').textContent ?? '').not.toContain('Connected');

    // With neither answered, the row says so rather than picking a side.
    renderRow(null, null);
    expect(screen.getAllByTestId('peer-row-ada')[1].textContent ?? '').toMatch(/not known/i);
  });

  it('colours the dot for each of the four states', () => {
    // The label and the colour are separate affordances; a row that says
    // "not known" under a red dot still tells a sighted user "Offline".
    const colour = (): string => {
      const dot: Element | null = screen.getAllByTestId('peer-row-ada').slice(-1)[0]
        .querySelector('.rounded-full.border-2');
      const cls: string = dot?.className ?? '';
      return cls.includes('bg-success') ? 'green'
        : cls.includes('bg-warning') ? 'amber'
        : cls.includes('bg-destructive') ? 'red'
        : 'muted';
    };

    renderRow(true, true); expect(colour()).toBe('green');
    renderRow(false, true); expect(colour()).toBe('amber');
    renderRow(false, false); expect(colour()).toBe('red');
    renderRow(null, null); expect(colour()).toBe('muted');
  });
});
