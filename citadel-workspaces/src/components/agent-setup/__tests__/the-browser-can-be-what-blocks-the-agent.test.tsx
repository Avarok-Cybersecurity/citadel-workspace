/**
 * When the browser, not the agent, is what blocks the page, the setup panel says so.
 *
 * Measured on Chrome 153 with the agent running: the loopback permission at its default
 * made the page say "Connection Failed ... Download Citadel for Mac". Reinstalling fixes
 * nothing there. These cover the three states Chrome reports and a browser with no such
 * permission at all.
 *
 * jsdom has no Permissions API, so the browser's is stood in for by a small object that
 * behaves as Chrome's does: it answers the names it knows and throws for the rest.
 */
import { describe, it, expect } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { AgentSetup } from '../AgentSetup';
import { AGENT_SETUP_COPY } from '@/lib/agent-setup-copy';
import { readLoopbackAccess, type LoopbackAccessReading } from '@/lib/loopback-permission';
import { useLoopbackAccess } from '@/hooks/use-loopback-access';

class Status extends EventTarget {
  constructor(public state: PermissionState) { super(); }
  become(next: PermissionState): void { this.state = next; this.dispatchEvent(new Event('change')); }
}

function browserKnowing(known: Record<string, Status>): Permissions {
  return {
    query: async ({ name }: { name: string }): Promise<PermissionStatus> => {
      const status: Status | undefined = known[name];
      if (!status) throw new TypeError(`'${name}' is not a valid enum value of type PermissionName.`);
      return status as unknown as PermissionStatus;
    },
  } as unknown as Permissions;
}

function navigatorWith(permissions: Permissions | undefined): Navigator {
  return { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', permissions } as unknown as Navigator;
}

describe('the loopback permission, read', () => {
  it('prefers Chrome 153 name, loopback-network', async () => {
    const reading: LoopbackAccessReading = await readLoopbackAccess(browserKnowing({ 'loopback-network': new Status('denied'), 'local-network-access': new Status('granted') }));
    expect(reading.state).toBe('denied');
  });

  it('falls back to the earlier local-network-access', async () => {
    expect((await readLoopbackAccess(browserKnowing({ 'local-network-access': new Status('prompt') }))).state).toBe('prompt');
  });

  it('is unknown where the browser has no such gate', async () => {
    expect((await readLoopbackAccess(browserKnowing({}))).state).toBe('unknown');
    expect((await readLoopbackAccess(undefined)).state).toBe('unknown');
  });
});

describe('the setup panel', () => {
  it('leads with how to allow it when the browser said no', async () => {
    render(<AgentSetup layout="compact" navigatorRef={navigatorWith(browserKnowing({ 'loopback-network': new Status('denied') }))} />);
    const note: HTMLElement = await screen.findByTestId('agent-setup-loopback');
    expect(note.textContent).toContain(AGENT_SETUP_COPY.loopback.deniedHeading);
    expect(note.getAttribute('data-state')).toBe('denied');
  });

  it('says to choose Allow while the browser has yet to ask', async () => {
    render(<AgentSetup layout="compact" navigatorRef={navigatorWith(browserKnowing({ 'loopback-network': new Status('prompt') }))} />);
    expect((await screen.findByTestId('agent-setup-loopback')).textContent).toContain(AGENT_SETUP_COPY.loopback.promptHeading);
  });

  it('adds nothing when access is granted or the gate does not exist', async () => {
    for (const permissions of [browserKnowing({ 'loopback-network': new Status('granted') }), browserKnowing({})]) {
      const { unmount } = render(<AgentSetup layout="compact" navigatorRef={navigatorWith(permissions)} />);
      await act(async () => { await Promise.resolve(); });
      expect(screen.queryByTestId('agent-setup-loopback')).toBeNull();
      unmount();
    }
  });
});

describe('granting it', () => {
  it('asks for a fresh page once, and follows the state', async () => {
    const status: Status = new Status('denied');
    let fresh: number = 0;
    const permissions: Permissions = browserKnowing({ 'loopback-network': status });
    const { result } = renderHook(() => useLoopbackAccess(permissions, () => { fresh += 1; }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current).toBe('denied');
    await act(async () => { status.become('granted'); });
    expect(result.current).toBe('granted');
    expect(fresh).toBe(1);
  });
});
