import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentSetup } from '../AgentSetup';
import {
  AGENT_ASSETS,
  AGENT_STUN_SERVERS,
  INSTALLER_ASSETS,
  type InstallerFamily,
} from '@/lib/agent-download';
import { AGENT_SETUP_COPY, VERIFY_COMMAND } from '@/lib/agent-setup-copy';

const nav: (platform: string, userAgent: string, maxTouchPoints?: number) => Navigator = (platform: string, userAgent: string, maxTouchPoints = 0): Navigator =>
  ({ platform, userAgent, maxTouchPoints }) as unknown as Navigator;

const MAC: Navigator = nav('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
const WIN: Navigator = nav('Win32', 'Mozilla/5.0 (Windows NT 10.0)');
const LINUX: Navigator = nav('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)');
const PHONES: Record<string, Navigator> = {
  iPhone: nav('iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'),
  Android: nav('Linux armv8l', 'Mozilla/5.0 (Linux; Android 14)'),
  iPad: nav('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5),
};
const DESKTOPS: Record<InstallerFamily, Navigator> = { mac: MAC, windows: WIN, linux: LINUX };

/** The `download` names offered, in document order. */
function offered(): string[] {
  return Array.from(screen.getByTestId('agent-setup').querySelectorAll('a[download]'))
    .map((a) => a.getAttribute('download') ?? '');
}

function openAdvanced(): Promise<void> {
  return userEvent.click(screen.getByRole('button', { name: AGENT_SETUP_COPY.advanced.toggle }));
}

describe('the one-click installer', () => {
  for (const family of Object.keys(DESKTOPS) as InstallerFamily[]) {
    it(`${family} gets its own installer first, and no other system's`, () => {
      render(<AgentSetup layout="compact" navigatorRef={DESKTOPS[family]} />);
      const names: string[] = offered();
      expect(names[0]).toBe(INSTALLER_ASSETS[family][0]);
      expect(names).toEqual([...INSTALLER_ASSETS[family]]);
      for (const other of Object.keys(INSTALLER_ASSETS) as InstallerFamily[]) {
        if (other === family) continue;
        for (const asset of INSTALLER_ASSETS[other]) expect(names).not.toContain(asset);
      }
      // Links resolve to the newest release of the asset they name.
      const first: HTMLAnchorElement | null = screen.getByTestId('agent-setup').querySelector('a[download]');
      expect(first?.getAttribute('href')).toMatch(new RegExp(`/releases/latest/download/${INSTALLER_ASSETS[family][0].replace(/\./g, '\\.')}$`));
    });
  }

  it('a Mac is told three steps and nothing to type', () => {
    render(<AgentSetup layout="compact" navigatorRef={MAC} />);
    for (const step of AGENT_SETUP_COPY.mac.steps) expect(screen.getByText(step)).toBeInTheDocument();
    expect(screen.queryByText(/--bind/)).toBeNull();
  });

  it('Windows is warned once about SmartScreen while the installer is unsigned', () => {
    render(<AgentSetup layout="compact" navigatorRef={WIN} />);
    expect(screen.getAllByText(/Windows protected your PC/)).toHaveLength(1);
    expect(screen.getByText(/More info, then Run anyway/)).toBeInTheDocument();
  });

  it('Linux offers the .deb for Ubuntu and Debian, then the AppImage with how to make it runnable', () => {
    render(<AgentSetup layout="compact" navigatorRef={LINUX} />);
    expect(screen.getByRole('link', { name: AGENT_SETUP_COPY.linux.debButton })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: AGENT_SETUP_COPY.linux.appImageButton })).toBeInTheDocument();
    expect(screen.getByText(/chmod \+x Citadel-Agent-x86_64\.AppImage/)).toBeInTheDocument();
  });

  for (const [name, phone] of Object.entries(PHONES)) {
    it(`${name} is offered no download at all, and told why`, () => {
      // A desktop download on a phone completes and never runs: worse than none.
      render(<AgentSetup layout="compact" navigatorRef={phone} />);
      expect(offered()).toEqual([]);
      expect(screen.getByText(AGENT_SETUP_COPY.noDevice)).toBeInTheDocument();
    });
  }
});

describe('Advanced', () => {
  it('is collapsed by default: no command and no archives until asked for', () => {
    render(<AgentSetup layout="compact" navigatorRef={LINUX} />);
    const toggle: HTMLElement = screen.getByRole('button', { name: AGENT_SETUP_COPY.advanced.toggle });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('agent-setup-advanced')).toBeNull();
    expect(screen.queryByText(/--bind/)).toBeNull();
    for (const archive of Object.values(AGENT_ASSETS)) expect(offered()).not.toContain(archive);
  });

  it('opens from the keyboard and reveals every archive, the full run command, checksums and the attestation check', async () => {
    render(<AgentSetup layout="full" navigatorRef={LINUX} />);
    const toggle: HTMLElement = screen.getByRole('button', { name: AGENT_SETUP_COPY.advanced.toggle });
    // Reached by Tab alone, past the download links before it.
    for (let i: number = 0; i < 5 && document.activeElement !== toggle; i += 1) await userEvent.tab();
    expect(toggle).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel: HTMLElement = screen.getByTestId('agent-setup-advanced');
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);

    for (const archive of Object.values(AGENT_ASSETS)) expect(offered()).toContain(archive);
    const cmd: HTMLElement = within(panel).getByRole('region', { name: AGENT_SETUP_COPY.advanced.runRegion });
    expect(cmd.textContent).toMatch(/^\.\/citadel-agent /);
    expect(cmd.textContent).toContain('--bind 127.0.0.1:12345 --backend filesystem');
    expect(cmd.textContent).toContain(`--allowed-origins ${window.location.origin}`);
    expect(cmd.textContent).toContain(`--stun-servers ${AGENT_STUN_SERVERS}`);
    expect(within(panel).getByRole('region', { name: AGENT_SETUP_COPY.advanced.verifyRegion }).textContent)
      .toBe(VERIFY_COMMAND);
    expect(VERIFY_COMMAND).toBe('gh attestation verify <file> --repo Avarok-Cybersecurity/citadel-workspace');
    expect(within(panel).getByRole('link', { name: /All releases and checksums/ }))
      .toHaveAttribute('href', expect.stringContaining('/releases/latest'));
  });

  it('is the same section on a phone, so an unrecognised device is not a dead end', async () => {
    render(<AgentSetup layout="compact" navigatorRef={PHONES.iPhone} />);
    await openAdvanced();
    for (const archive of Object.values(AGENT_ASSETS)) expect(offered()).toContain(archive);
  });

  it('gives Windows the .exe form of the command', async () => {
    render(<AgentSetup layout="compact" navigatorRef={WIN} />);
    await openAdvanced();
    expect(screen.getByRole('region', { name: AGENT_SETUP_COPY.advanced.runRegion }).textContent)
      .toMatch(/^\.\\citadel-agent\.exe /);
  });

  it('keeps the command free of loopback flags the agent does not have, even on a hosted page', async () => {
    const meta: HTMLMetaElement = document.createElement('meta');
    meta.name = 'citadel-loopback-agent';
    meta.content = 'wss://local.example.com:12345';
    document.head.appendChild(meta);
    try {
      render(<AgentSetup layout="compact" navigatorRef={LINUX} />);
      await openAdvanced();
      const cmd: HTMLElement = screen.getByText(/--allowed-origins/);
      expect(cmd.textContent).toContain(`--allowed-origins ${window.location.origin}`);
      expect(cmd.textContent).not.toContain('--loopback');
    } finally {
      meta.remove();
    }
  });

  it('copies exactly once per keyboard activation', async () => {
    // A native <button> activates on Enter by itself and interactive() adds an onKeyDown on
    // top; one press yields one copy only because activateOnKey preventDefault()s Enter.
    const writes: string[] = [];
    Object.assign(navigator, {
      clipboard: { writeText: (t: string) => { writes.push(t); return Promise.resolve(); } },
    });
    render(<AgentSetup layout="compact" navigatorRef={LINUX} />);
    await openAdvanced();
    screen.getByRole('button', { name: AGENT_SETUP_COPY.advanced.runCopy }).focus();
    await userEvent.keyboard('{Enter}');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('--bind 127.0.0.1:12345 --backend filesystem');
  });
});

describe('layout', () => {
  it('compact leads with the question; full leaves the heading to the page', () => {
    const { unmount } = render(<AgentSetup layout="compact" navigatorRef={MAC} />);
    expect(screen.getByText(AGENT_SETUP_COPY.question)).toBeInTheDocument();
    unmount();
    render(<AgentSetup layout="full" navigatorRef={MAC} />);
    expect(screen.queryByText(AGENT_SETUP_COPY.question)).toBeNull();
    expect(screen.getByText(AGENT_SETUP_COPY.intro)).toBeInTheDocument();
  });
});
