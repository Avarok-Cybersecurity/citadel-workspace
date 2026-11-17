/**
 * A build that crashes at render shows the error boundary — which unmounts
 * PwaUpdatePrompt, the ONLY sender of SKIP_WAITING in the app. A fixed build can
 * then download, install, and sit in `waiting` for ever while the user presses
 * "Reload workspace" against the same crash, because a same-tab reload does not
 * activate a waiting worker. Recovery otherwise means closing every tab on the
 * origin, which nothing tells the user.
 */
import { describe, it, expect, vi, beforeEach, afterEach  } from 'vitest';
import { applyWaitingUpdate, reloadApplyingAnyWaitingUpdate } from '../apply-waiting-update';

const original: ReturnType<typeof Object.getOwnPropertyDescriptor> = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

function installContainer(registration: unknown): { fire: (type: string) => void; } {
  const listeners: Record<string, (() => void)[]> = {};
  const container: { getRegistration: () => Promise<unknown>; addEventListener: (type: string, fn: () => void) => void; removeEventListener: (type: string, fn: () => void) => void; } = {
    getRegistration: (): Promise<unknown> => Promise.resolve(registration),
    addEventListener: (type: string, fn: () => void): void => {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener: (type: string, fn: () => void): void => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
  return { fire: (type: string): void => (listeners[type] ?? []).forEach((f): void => f()) };
}

describe('applyWaitingUpdate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    if (original) Object.defineProperty(navigator, 'serviceWorker', original);
  });

  it('sends SKIP_WAITING to a waiting worker and resolves once it takes control', async () => {
    const postMessage: ReturnType<typeof vi.fn> = vi.fn();
    const { fire } = installContainer({ waiting: { postMessage } });

    const result: Promise<boolean> = applyWaitingUpdate();
    // Flush the awaited getRegistration() before asserting on what it sent.
    await vi.advanceTimersByTimeAsync(0);

    // The message the built service worker actually listens for.
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });

    fire('controllerchange');
    await expect(result).resolves.toBe(true);
  });

  it('gives up rather than hanging when the worker never takes control', async () => {
    installContainer({ waiting: { postMessage: vi.fn() } });

    const result: Promise<boolean> = applyWaitingUpdate();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000);

    await expect(result).resolves.toBe(false);
  });

  it('does nothing when no update is waiting', async () => {
    installContainer({ waiting: null });
    await expect(applyWaitingUpdate()).resolves.toBe(false);
  });

  it('reloads even when activation fails — the user pressed a button', async () => {
    installContainer({ waiting: { postMessage: vi.fn() } });
    const reload: ReturnType<typeof vi.fn> = vi.fn();

    const done: Promise<void> = reloadApplyingAnyWaitingUpdate(reload);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000);
    await done;

    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads when there is no service worker at all', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    const reload: ReturnType<typeof vi.fn> = vi.fn();

    await reloadApplyingAnyWaitingUpdate(reload);

    expect(reload).toHaveBeenCalledOnce();
  });
});
