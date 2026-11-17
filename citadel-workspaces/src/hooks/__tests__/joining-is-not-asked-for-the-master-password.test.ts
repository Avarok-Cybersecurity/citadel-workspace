/**
 * Answering "I am joining" must stop the master-password prompt.
 *
 * The onboarding dialog collects an `'admin' | 'member'` answer and, until now,
 * threw it away: `onChoose` and `onDismiss` were both wired to the same
 * zero-argument `resolve`, so choosing "setting up a new workspace", choosing
 * "joining a workspace someone else set up", and closing the dialog were
 * literally indistinguishable. A member was then shown
 * WorkspaceInitializationModal — which asks for WORKSPACE_MASTER_PASSWORD, a
 * secret they have no way to obtain — one screen after the dialog had promised
 * them they "should not be asked for it".
 *
 * These assert the three answers are now three different outcomes. The `admin`
 * and dismiss cases are as important as the `member` one: a suppression that
 * fires for everybody is the same defect wearing the opposite sign, and it would
 * hide the prompt from the one person who is supposed to see it.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnboardingIntent } from '../useOnboardingIntent';
import { initPromptSuppressed, INIT_PROMPT_SUPPRESSED_KEY } from '@/lib/workspace-init-prompt';

// The dialog only opens in production; `request()` starts the wizard directly in
// development, so without this every case below would skip the dialog entirely
// and pass for the wrong reason.
vi.mock('@/lib/debug-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/debug-config')>()),
  isOnboardingEnabled: (): boolean => true,
}));

describe('the onboarding answer', () => {
  beforeEach(() => {
    sessionStorage.removeItem(INIT_PROMPT_SUPPRESSED_KEY);
  });
  afterEach(() => {
    sessionStorage.removeItem(INIT_PROMPT_SUPPRESSED_KEY);
  });

  it('is nothing before the dialog is answered', () => {
    // The control for all three cases below: if this were already true, every
    // one of them would pass without the hook doing anything at all.
    expect(initPromptSuppressed()).toBe(false);
  });

  it('stops the master-password prompt when the user says they are joining', () => {
    const begin: ReturnType<typeof vi.fn> = vi.fn();
    const { result } = renderHook(() => useOnboardingIntent(begin, vi.fn()));

    act(() => { result.current.request(); });
    expect(result.current.open, 'the dialog must actually be showing').toBe(true);
    expect(initPromptSuppressed(), 'opening the dialog decides nothing').toBe(false);

    act(() => { result.current.resolve('member'); });

    expect(initPromptSuppressed()).toBe(true);
    // And the wizard still runs: this sets an expectation, it does not gate entry.
    expect(begin).toHaveBeenCalledTimes(1);
    expect(result.current.open).toBe(false);
  });

  it('leaves the prompt in place for someone setting a workspace up', () => {
    const begin: ReturnType<typeof vi.fn> = vi.fn();
    const { result } = renderHook(() => useOnboardingIntent(begin, vi.fn()));

    act(() => { result.current.request(); });
    act(() => { result.current.resolve('admin'); });

    expect(initPromptSuppressed(), 'the admin is the one person who needs it').toBe(false);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('leaves the prompt in place when the user closes the dialog without answering', () => {
    const begin: ReturnType<typeof vi.fn> = vi.fn();
    const { result } = renderHook(() => useOnboardingIntent(begin, vi.fn()));

    act(() => { result.current.request(); });
    act(() => { result.current.resolve(); });

    expect(initPromptSuppressed(), 'saying nothing is not saying "I am joining"').toBe(false);
    expect(begin).toHaveBeenCalledTimes(1);
  });
});

/**
 * "Setting up a new workspace" opens the hosted create-workspace flow -- but
 * only where the deployment publishes a control plane. Everywhere else it is
 * the wizard and the master password, exactly as before, which the case above
 * ("leaves the prompt in place for someone setting a workspace up") pins with
 * no meta present.
 */
describe('setting up, where this deployment creates workspaces', () => {
  function publishControlPlane(content: string): () => void {
    const meta: HTMLMetaElement = document.createElement('meta');
    meta.name = 'citadel-control-plane';
    meta.content = content;
    document.head.appendChild(meta);
    return () => meta.remove();
  }

  it('goes to /create instead of the wizard', () => {
    const unpublish: () => void = publishControlPlane('/api');
    try {
      const begin: ReturnType<typeof vi.fn> = vi.fn();
      const create: ReturnType<typeof vi.fn> = vi.fn();
      const { result } = renderHook(() => useOnboardingIntent(begin, create));
      act(() => { result.current.request(); });
      act(() => { result.current.resolve('admin'); });
      expect(create).toHaveBeenCalledWith('/create');
      expect(begin).not.toHaveBeenCalled();
      expect(result.current.open).toBe(false);
    } finally {
      unpublish();
    }
  });

  it('still runs the wizard for someone joining', () => {
    const unpublish: () => void = publishControlPlane('/api');
    try {
      const begin: ReturnType<typeof vi.fn> = vi.fn();
      const create: ReturnType<typeof vi.fn> = vi.fn();
      const { result } = renderHook(() => useOnboardingIntent(begin, create));
      act(() => { result.current.request(); });
      act(() => { result.current.resolve('member'); });
      expect(begin).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
    } finally {
      unpublish();
    }
  });
});
