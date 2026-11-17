/**
 * The install affordance must still work after the user signs in.
 *
 * Chromium fires `beforeinstallprompt` once per page load, early, and it cannot
 * be requested later — the only way to show an install dialog is to replay the
 * event you caught. It was stashed in `useState` inside `usePwaInstall`, with
 * the listener registered in that instance's mount effect, so every consumer had
 * its own listener and its own copy.
 *
 * That broke the ordinary journey exactly. The event fires while the user is on
 * the landing page; signing in unmounts Landing, taking its stashed copy with
 * it, and mounts the TopBar consumer AFTER the event has already fired. So the
 * user-menu install entry — added precisely because installing was only offered
 * on the landing page — could never appear for anyone who had signed in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act , type RenderHookResult } from '@testing-library/react';
import { usePwaInstall } from '../usePwaInstall';
import type { PwaInstallState } from '@/components/pwa/usePwaInstall';
import {
  startInstallPromptCapture,
  resetInstallPromptCaptureForTests,
} from '../install-prompt-store';

function fireInstallPrompt(): Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string; platform: string; }>; } {
  const event: Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string; platform: string; }>; } = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string; platform: string }>;
  };
  event.prompt = (): Promise<void> => Promise.resolve();
  event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  resetInstallPromptCaptureForTests();
  // jsdom has no matchMedia by default.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  startInstallPromptCapture();
});

afterEach(() => {
  resetInstallPromptCaptureForTests();
});

describe('usePwaInstall', () => {
  it('offers installation to a consumer that mounted BEFORE the event', () => {
    const landing: RenderHookResult<PwaInstallState, unknown> = renderHook((): PwaInstallState => usePwaInstall());
    expect(landing.result.current.canInstall).toBe(false);

    fireInstallPrompt();

    expect(landing.result.current.canInstall).toBe(true);
  });

  it('offers installation to a consumer that mounts AFTER the event', () => {
    // The real sequence: the event fires on the landing page...
    const landing: RenderHookResult<PwaInstallState, unknown> = renderHook((): PwaInstallState => usePwaInstall());
    fireInstallPrompt();
    expect(landing.result.current.canInstall).toBe(true);

    // ...the user signs in, so that page goes away...
    landing.unmount();

    // ...and the signed-in shell mounts its own consumer. This is the case that
    // was broken: a fresh instance had missed the single event.
    const topBar: RenderHookResult<PwaInstallState, unknown> = renderHook((): PwaInstallState => usePwaInstall());
    expect(topBar.result.current.canInstall).toBe(true);
  });

  it('shows every mounted consumer the same answer', () => {
    const a: RenderHookResult<PwaInstallState, unknown> = renderHook((): PwaInstallState => usePwaInstall());
    const b: RenderHookResult<PwaInstallState, unknown> = renderHook((): PwaInstallState => usePwaInstall());
    fireInstallPrompt();

    expect(a.result.current.canInstall).toBe(true);
    expect(b.result.current.canInstall).toBe(true);
  });

  it('stops offering once the prompt has been consumed', async () => {
    const hook: RenderHookResult<PwaInstallState, unknown> = renderHook((): PwaInstallState => usePwaInstall());
    fireInstallPrompt();
    expect(hook.result.current.canInstall).toBe(true);

    await act(async () => {
      await hook.result.current.install();
    });

    // Single-use whichever way the user answers; the browser decides whether to
    // offer another.
    expect(hook.result.current.canInstall).toBe(false);
  });

  it('stops offering once the app reports itself installed', () => {
    const hook: RenderHookResult<PwaInstallState, unknown> = renderHook((): PwaInstallState => usePwaInstall());
    fireInstallPrompt();

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(hook.result.current.canInstall).toBe(false);
    expect(hook.result.current.isInstalled).toBe(true);
  });
});
