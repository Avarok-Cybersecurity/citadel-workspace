import { DB_NAME } from './lib/storage-migrations';
import { sessionGet, sessionRemove, sessionSet } from './lib/safe-session-storage';

/**
 * The rollback recovery screen.
 *
 * Split out of `main.tsx`, which was at its line budget and holds the app's
 * boot sequence. This is one self-contained thing: the last-resort screen shown
 * when IndexedDB refuses to open because the stored schema is NEWER than this
 * build understands — the shape a user hits after a rollback, or after opening
 * an old cached bundle.
 */
const RELOAD_ATTEMPTED_KEY: "citadel-storage-version-reload-attempted" = 'citadel-storage-version-reload-attempted';

/** Wipe the local database, then reload. The last resort, and it loses data. */
function resetLocalData(button: HTMLButtonElement): void {
  button.disabled = true;
  button.textContent = 'Resetting…';
  sessionRemove(RELOAD_ATTEMPTED_KEY);

  const request: ReturnType<typeof indexedDB.deleteDatabase> = indexedDB.deleteDatabase(DB_NAME);
  const reload = (): void => window.location.reload();
  request.onsuccess = reload;
  request.onerror = reload;
  // `onblocked` fires when another tab still holds the database open, and it
  // never resolves on its own. Saying so beats a button that sits at
  // "Resetting…" for ever.
  request.onblocked = (): void => {
    button.textContent = 'Close other Citadel tabs, then try again';
    button.disabled = false;
  };
}

/** The destructive way out, shown once the safe option has been tried. */
function offerReset(panel: HTMLElement): void {
  if (panel.dataset.resetOffered) return;
  panel.dataset.resetOffered = 'true';
  const stillStuck: ReturnType<typeof document.createElement> = document.createElement('p');
  stillStuck.textContent =
    'Still seeing this after reloading? Then this device is running the version the ' +
    'server is serving, and reloading cannot help. Resetting removes the data Citadel ' +
    'stored in this browser — messages and files cached here, and any saved sign-in. ' +
    'Your account and anything on the server are not affected.';
  stillStuck.style.cssText = 'margin:1.5rem 0 0.75rem;font-size:0.9rem;opacity:0.85';

  const reset: HTMLButtonElement = document.createElement('button');
  reset.textContent = 'Reset local data on this device';
  reset.style.cssText =
    'padding:0.6rem 1rem;border-radius:0.5rem;border:1px solid currentColor;' +
    'background:transparent;color:inherit;font:inherit;cursor:pointer';
  reset.addEventListener('click', () => resetLocalData(reset));

  panel.append(stillStuck, reset);
}

/**
 * A recovery screen for the rollback case, built with safe DOM APIs.
 *
 * Two options, in escalating order, because the two causes need different
 * answers and only one of them is safe.
 *
 * "Get the current version" unregisters the service worker before reloading:
 * a stale bundle is very often being served FROM the worker's precache, so a
 * plain reload hands back the same build and the same error. That is the whole
 * fix when the cause is a cached copy — and it is useless when the cause is a
 * genuine ROLLBACK, where the server is deliberately serving the older build
 * and every reload returns it.
 *
 * The screen used to offer only that, so a rolled-back deployment left the user
 * pressing a button that could not work, with their data unreachable and
 * nothing else to try. Wiping the local database IS the answer there, and it is
 * destructive, so it appears only after the safe option has already been tried
 * and returned here — which is exactly the signal that distinguishes the two
 * causes.
 */
export function showStorageVersionRecovery(): void {
  const rootElement: HTMLElement | null = document.getElementById('root');
  if (!rootElement || rootElement.dataset.recovery === 'storage-version') return;
  rootElement.dataset.recovery = 'storage-version';
  rootElement.replaceChildren();

  const panel: HTMLDivElement = document.createElement('div');
  panel.setAttribute('role', 'alert');
  panel.style.cssText =
    'max-width:34rem;margin:12vh auto;padding:2rem;font-family:system-ui,sans-serif;line-height:1.6';

  const heading: ReturnType<typeof document.createElement> = document.createElement('h1');
  heading.textContent = 'This version is older than your saved data';
  heading.style.cssText = 'font-size:1.25rem;margin:0 0 0.75rem';

  const body: ReturnType<typeof document.createElement> = document.createElement('p');
  body.textContent =
    'Your browser is running an older build of Citadel than the data stored on this device. ' +
    'That usually means a cached copy loaded, or the app was rolled back. Getting the current ' +
    'version will fix it — your data is untouched.';
  body.style.cssText = 'margin:0 0 1.25rem';

  const button: HTMLButtonElement = document.createElement('button');
  button.textContent = 'Get the current version';
  button.style.cssText =
    'padding:0.6rem 1rem;border-radius:0.5rem;border:1px solid currentColor;background:transparent;' +
    'color:inherit;font:inherit;cursor:pointer';
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Reloading…';
    // A reload that cannot be remembered lands back here looking untried, for ever:
    // where storage refuses the marker, offer the way out now instead.
    if (!sessionSet(RELOAD_ATTEMPTED_KEY, '1')) {
      button.disabled = false;
      button.textContent = 'Get the current version';
      offerReset(panel);
      return;
    }
    void navigator.serviceWorker?.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
      .catch(() => undefined)
      .finally(() => window.location.reload());
  });

  panel.append(heading, body, button);

  // Only after the safe option has been tried and landed back here.
  if (sessionGet(RELOAD_ATTEMPTED_KEY)) offerReset(panel);

  rootElement.append(panel);
}
