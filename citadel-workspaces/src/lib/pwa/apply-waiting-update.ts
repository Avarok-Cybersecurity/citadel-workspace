import { TIMEOUT } from '@/lib/timeout-constants';

/**
 * Hand control to a service worker that is sitting in `waiting`, if there is one.
 *
 * A plain `location.reload()` does NOT activate a waiting worker: the old one
 * keeps controlling the page, so it keeps serving the old precached shell. That
 * is fine for an ordinary reload, and fatal for the one case where it matters —
 * a build that crashes at render.
 *
 * In that case the error boundary is showing, which means `PwaUpdatePrompt` is
 * unmounted, and it is the ONLY thing in the app that sends SKIP_WAITING. A fixed
 * build can therefore download, install, and sit in `waiting` for ever while the
 * user presses "Reload workspace" against the same crash. Recovery otherwise
 * requires closing every tab on the origin, which nothing tells the user.
 *
 * Resolves `true` only if a new worker actually took control. The caller should
 * reload either way — the user pressed a button and is owed an outcome.
 */
export async function applyWaitingUpdate(): Promise<boolean> {
  const container: ServiceWorkerContainer | undefined = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  if (!container) return false;

  const registration: ServiceWorkerRegistration | undefined = await container.getRegistration().catch((): undefined => undefined);
  const waiting: ServiceWorker | null | undefined = registration?.waiting;
  if (!waiting) return false;

  const tookControl: Promise<boolean> = new Promise<boolean>((resolve) => {
    const onControllerChange = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer: NodeJS.Timeout = setTimeout((): void => {
      container.removeEventListener('controllerchange', onControllerChange);
      resolve(false);
    }, TIMEOUT.SW_ACTIVATION_MS);
    container.addEventListener('controllerchange', onControllerChange, { once: true });
  });

  waiting.postMessage({ type: 'SKIP_WAITING' });
  return tookControl;
}

/**
 * The recovery action for a crashed render: activate any waiting fix first, then
 * reload. Reloads even when activation fails or times out.
 */
export async function reloadApplyingAnyWaitingUpdate(reload: () => void): Promise<void> {
  try {
    await applyWaitingUpdate();
  } finally {
    reload();
  }
}
