import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentSetup } from '../AgentSetup';
import type { JSX } from 'react';
import { OS_ICONS } from '@/components/icons/os-icons';
import type { AgentPlatform } from '@/lib/agent-download';

/**
 * The download buttons must be the visitor's platform, and must LOOK like it.
 *
 * Two halves, and each is worthless alone:
 *
 *   - Detection. Each desktop is offered its own one-click installer and no
 *     other system's; phones and tablets are offered nothing.
 *   - The mark. Every button once rendered the same generic download arrow, so
 *     on a Mac -- then offered two archives side by side -- the icon carried no
 *     information at all. A test that only counted buttons passed throughout.
 *     The mark is still how a visitor sees at a glance that the page read
 *     their system correctly.
 *
 * The icons are asserted as distinct RENDERED paths rather than by component
 * identity: `OS_ICONS.windows-x64 !== OS_ICONS.linux-x64` would hold for two
 * components that draw the same glyph, which is exactly the state this replaced.
 */
function navigatorFor(ua: string, platform: string, maxTouchPoints: number = 0): Navigator {
  return { userAgent: ua, platform, maxTouchPoints } as unknown as Navigator;
}

const WINDOWS: Navigator = navigatorFor('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32');
const LINUX: Navigator = navigatorFor('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64');
const MAC: Navigator = navigatorFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel');
const IPAD: Navigator = navigatorFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5);

function Hint({ navigatorRef }: { navigatorRef: Navigator }): JSX.Element {
  return <AgentSetup layout="compact" navigatorRef={navigatorRef} />;
}

function pathsOf(container: HTMLElement, testId: string): string[] {
  const link: HTMLElement | null = container.querySelector(`[data-testid="${testId}"]`);
  if (!link) throw new Error(`no download button ${testId}`);
  return Array.from(link.querySelectorAll('svg path')).map((p) => p.getAttribute('d') ?? '');
}

describe('agent download buttons', () => {
  it('offers Windows alone on Windows', () => {
    const { container } = render(<Hint navigatorRef={WINDOWS} />);
    expect(container.querySelectorAll('[data-testid^="agent-download-"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="agent-download-windows-installer"]')).not.toBeNull();
  });

  it('offers a Mac the one universal app, since the arch cannot be told apart and no longer has to be', () => {
    const { container } = render(<Hint navigatorRef={MAC} />);
    expect(container.querySelectorAll('[data-testid^="agent-download-"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="agent-download-macos-app"]')).not.toBeNull();
  });

  it('offers nothing runnable on an iPad, and says so', () => {
    const { container } = render(<Hint navigatorRef={IPAD} />);
    expect(container.querySelectorAll('[data-testid^="agent-download-"]')).toHaveLength(0);
    expect(screen.getByText(/this device cannot host one/i)).toBeTruthy();
  });

  it('draws a different mark for each operating system', () => {
    const win: string[] = pathsOf(
      render(<Hint navigatorRef={WINDOWS} />).container,
      'agent-download-windows-installer',
    );
    const lin: string[] = pathsOf(
      render(<Hint navigatorRef={LINUX} />).container,
      'agent-download-linux-deb',
    );
    const mac: string[] = pathsOf(
      render(<Hint navigatorRef={MAC} />).container,
      'agent-download-macos-app',
    );

    for (const paths of [win, lin, mac]) {
      expect(paths.length).toBeGreaterThan(0);
      expect(paths[0].length).toBeGreaterThan(40); // a real glyph, not a placeholder
    }
    expect(new Set([win[0], lin[0], mac[0]]).size).toBe(3);
  });

  it('has a mark for every platform the release workflow builds', () => {
    const platforms: AgentPlatform[] = ['macos-arm64', 'macos-x64', 'linux-x64', 'windows-x64'];
    for (const p of platforms) expect(OS_ICONS[p]).toBeTypeOf('function');
  });

  it('keeps the marks decorative — the label already names the platform', () => {
    const { container } = render(<Hint navigatorRef={LINUX} />);
    const svg: SVGElement | null = container.querySelector(
      '[data-testid="agent-download-linux-deb"] svg',
    );
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText(/Ubuntu or Debian/)).toBeTruthy();
  });
});
