/**
 * The install affordance was the one PWA surface with no unit test, while the
 * offline banner and update prompt both had one. It is also the half of
 * installability that CI's static manifest check cannot see: `check:pwa` proves
 * the app QUALIFIES to be installed, not that anything in the UI lets you.
 *
 * The `beforeinstallprompt` event is single-use and Chromium decides when to
 * fire it, so this drives it directly rather than waiting for a real browser.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { InstallAppButton } from '../InstallAppButton';
import {
  startInstallPromptCapture,
  resetInstallPromptCaptureForTests,
} from '../install-prompt-store';

const toast: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: (): { toast: ReturnType<typeof vi.fn> } => ({ toast }),
}));

/** A stand-in for the event Chromium fires; the DOM lib does not declare it. */
function makePromptEvent(outcome: 'accepted' | 'dismissed'): Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string; platform: string; }>; platforms: string[]; } {
  const event: Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string; platform: string; }>; platforms: string[]; } = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string; platform: string }>;
    platforms: string[];
  };
  event.platforms = ['web'];
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
}

function fireInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted'): Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string; platform: string; }>; platforms: string[]; } {
  const event: Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string; platform: string; }>; platforms: string[]; } = makePromptEvent(outcome);
  act(() => { window.dispatchEvent(event); });
  return event;
}

function setStandalone(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('display-mode: standalone') ? matches : false,
    media: query,
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
    addListener: (): void => {},
    removeListener: (): void => {},
    dispatchEvent: (): boolean => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

describe('InstallAppButton', () => {
  beforeEach(() => {
    toast.mockClear();
    setStandalone(false);
    // The capture moved out of the hook and into a module-scope store, so the
    // event no longer reaches anything until the store is listening. In the app
    // main.tsx starts it before React mounts; here each test starts it fresh.
    resetInstallPromptCaptureForTests();
    startInstallPromptCapture();
  });
  afterEach(() => { resetInstallPromptCaptureForTests(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders nothing until the browser offers a prompt', () => {
    const { container } = render(<InstallAppButton />);
    // A button that cannot install is worse than no button: it looks broken.
    expect(container).toBeEmptyDOMElement();
  });

  it('appears once the browser offers one', () => {
    render(<InstallAppButton />);
    fireInstallPrompt();
    expect(screen.getByRole('button', { name: /install app/i })).toBeInTheDocument();
  });

  it('suppresses the browser mini-infobar so the app controls placement', () => {
    render(<InstallAppButton />);
    const event: Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string; platform: string; }>; platforms: string[]; } = makePromptEvent('accepted');
    const prevented: ReturnType<typeof vi.spyOn> = vi.spyOn(event, 'preventDefault');
    act(() => { window.dispatchEvent(event); });
    expect(prevented).toHaveBeenCalled();
  });

  it('confirms an accepted install', async () => {
    render(<InstallAppButton />);
    const event: Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string; platform: string; }>; platforms: string[]; } = fireInstallPrompt('accepted');
    await act(async () => { screen.getByRole('button', { name: /install app/i }).click(); });

    expect(event.prompt).toHaveBeenCalled();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Citadel installed' })),
    );
  });

  it('says nothing when the user declines', async () => {
    render(<InstallAppButton />);
    fireInstallPrompt('dismissed');
    await act(async () => { screen.getByRole('button', { name: /install app/i }).click(); });
    // Declining is a choice, not a failure — nagging about it is the defect.
    expect(toast).not.toHaveBeenCalled();
  });

  it('retires the button after use, because the event is single-use', async () => {
    render(<InstallAppButton />);
    fireInstallPrompt('dismissed');
    await act(async () => { screen.getByRole('button', { name: /install app/i }).click(); });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /install app/i })).not.toBeInTheDocument(),
    );
  });

  it('offers nothing when already running installed', () => {
    setStandalone(true);
    render(<InstallAppButton />);
    fireInstallPrompt();
    // display-mode: standalone means this IS the installed copy.
    expect(screen.queryByRole('button', { name: /install app/i })).not.toBeInTheDocument();
  });

  it('disappears when the app reports itself installed', async () => {
    render(<InstallAppButton />);
    fireInstallPrompt();
    expect(screen.getByRole('button', { name: /install app/i })).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /install app/i })).not.toBeInTheDocument(),
    );
  });
});
