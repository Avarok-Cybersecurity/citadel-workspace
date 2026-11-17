import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import './index.css'
// Logo colours. Separate from the design tokens on purpose -- see the header
// of the file: the mark must not inherit a workspace's palette.
import './styles/brand-tokens.css'

// Initialize WASM peer bridge (provides peer connection state to WASM ILM via JS callback)
import { initWasmPeerBridge } from './lib/wasm-peer-bridge'
initWasmPeerBridge();

// Expose singleton services on window for dev tools and integration testing.
//
// These are imported DYNAMICALLY inside the DEV branch, not at module scope. A
// static import runs regardless of the `if`, so the production bundle carried
// four service modules whose only purpose was to be assigned to window in
// development — and, because they sit on the entry chunk's import graph, they
// were fetched and evaluated before React could paint anything. Rollup drops
// this branch entirely from a production build.
if (import.meta.env.DEV) {
  void Promise.all([
    import('./lib/p2p-registration-service'),
    import('./lib/p2p-auto-connect-service'),
    import('./lib/websocket-service'),
    import('./lib/connection/service'),
    import('./lib/server-auto-connect-service'),
  ]).then(([reg, auto, ws, conn, serverAuto]) => {
    window.__p2pRegistrationService = reg.p2pRegistrationService;
    window.__p2pAutoConnectService = auto.p2pAutoConnectService;
    window.__websocketService = ws.websocketService;
    window.__connectionManager = conn.connectionManager;
    // Exposed so a test can wait for the reconnect cycle to go quiet
    // (getPendingReconnectCount() === 0) instead of sleeping out its ~30s poll
    // interval. Two specs were spending 35s each doing exactly that.
    window.__serverAutoConnectService = serverAuto.serverAutoConnectService;
  });
}

// Initialize instance inbound router (routes WebSocket responses to correct instance)
// Must be imported early to set up event listeners before any messages are processed
import './lib/multi-instance';
import { startInstallPromptCapture } from '@/components/pwa/install-prompt-store';
import { showStorageVersionRecovery } from './storage-version-recovery';
import { REJECTION_TAG, WINDOW_ERROR_TAG } from './lib/telemetry/window-error-tags';
import { startKeyboardInsetTracking } from '@/lib/pwa/keyboard-inset';
import { watchThisBuild } from '@/lib/pwa/watch-deployed-version';
import { browserSessionStorage, reloadKeepingDrafts, restoreHandedOffDrafts } from '@/lib/chat/draft-handoff';
import { captureBootLinks } from '@/lib/boot-links';
import { applyAppearanceSettings, loadAppearanceSettings } from './lib/appearance-settings';
import { initPrivacySettingsSync } from './lib/privacy-settings';
import { provideAtRestRootStore, type AtRestRootStore } from './lib/at-rest/root-store-port';

// Before render, so the user's font size, sidebar width, avatar and motion
// choices are in place for the first paint rather than snapping into effect
// later -- or, as was the case, only while the Settings tab happened to be open.
applyAppearanceSettings(loadAppearanceSettings());

// Arm the cross-tab invalidation the privacy cache's own comment promises.
//
// `getPrivacySettings` memoises, and the comment above the cache says it is
// "Invalidated by every write, including writes from another tab". Only half of
// that was true: the writing tab clears its own cache, and the `storage`
// listener that clears everyone else's was never installed, because
// initPrivacySettingsSync had no caller. In an explicitly multi-tab app that
// means turning off "Send read receipts" in one tab left every other tab
// sending them until it was reloaded -- the switch reads off, and the promise
// it makes is broken in the tab the user is not looking at.
initPrivacySettingsSync();
// Encryption at rest keeps its root in the agent; the store loads with the first root needed.
provideAtRestRootStore(async (): Promise<AtRestRootStore> => (await import('./lib/at-rest/agent-root-store')).agentRootStore);

// Construct the P2P messenger during boot so its 'websocket-message'
// subscription — the gate the inbound router acks forwarded messages on —
// attaches without waiting for someone to open chat.
//
// It is a LAZY singleton behind a Proxy, so a tab that never touches chat UI
// never constructed it, never marked itself ready, and every forward to that
// tab therefore waited out the full retention timeout before the leader fell
// back. Correct, but two seconds slower than it needs to be, on every message.
//
// Imported dynamically, exactly like the dev services above: a static import
// would put the whole P2P graph on the entry chunk and onto the landing
// critical path, which has ~11KB of headroom against its budget. This keeps
// the eager construction without paying for it before first paint.
void import('./lib/p2p').then((m) => {
  // Message Retention for chats nobody opens: swept once the messenger is up,
  // then hourly. See lib/p2p/retention-sweep.
  void m.p2pMessengerManager.waitForReady().then((): void => m.startRetentionSweeper());
});

// Global error handlers; their lines reach opt-in diagnostic logs (lib/telemetry/console-capture).
window.addEventListener('error', (e) => {
  console.error(WINDOW_ERROR_TAG, {
    message: e.error?.message || e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    stack: e.error?.stack
  });
});

window.addEventListener('unhandledrejection', (e) => {
  console.error(REJECTION_TAG, {
    reason: e.reason,
    promise: e.promise
  });

  // A VersionError means the on-disk IndexedDB is NEWER than this build expects
  // — the normal, expected state during a ROLLBACK, and for anyone running a
  // stale cached bundle. IndexedDB has no downgrade path.
  //
  // storage-utils diagnoses this precisely, but only through `errorLog`, which
  // is gated behind the diagnostics flag, and then rethrows into an async
  // effect where React error boundaries cannot reach it. The result was a
  // permanently spinning loader with no error, no toast and no recovery action
  // — on the one operation you reach for during an incident. Support sees "the
  // app just spins".
  const reason: unknown = e.reason;
  if (reason instanceof DOMException && reason.name === 'VersionError') {
    e.preventDefault();
    showStorageVersionRecovery();
  }
});

try {
  const rootElement: HTMLElement | null = document.getElementById("root");

  if (!rootElement) {
    throw new Error("Root element not found");
  }

  // Register the service worker OUTSIDE React, before rendering.
  //
  // The only registration used to be `useRegisterSW` inside PwaUpdatePrompt,
  // which mounts inside AppErrorBoundary. A build that threw during render
  // therefore took the update path down with it: the boundary replaced the
  // tree, `registration.update()` never ran, and the reload button re-served
  // the same precached shell. Users were stuck on the broken build with no way
  // to receive the fix — the one failure a prompt-mode PWA must not have,
  // because shipping a correction is the whole recovery plan.
  //
  // Registration is idempotent per scope, so PwaUpdatePrompt's hook attaches to
  // this same registration and keeps owning the toast and the reload action.
  const updateSW: (reloadPage?: boolean) => Promise<void> = registerSW({
    immediate: true,
    // onNeedReload is what suppresses the library's automatic reload.
    //
    // vite-plugin-pwa arms `controlling → window.location.reload()` unless this
    // is supplied, and it arms it in EVERY window that sees the waiting worker.
    // skipWaiting takes over all clients at once, so accepting the update in
    // one window hard-reloaded every other one — dropping their WebSocket, P2P
    // channels and in-flight document state mid-sentence. That is the exact
    // guarantee registerType:'prompt' was chosen to provide, and this
    // registration was quietly voiding it.
    //
    // PwaUpdatePrompt owns the reload for the window whose user clicked.
    onNeedReload: () => {},
    onRegisterError: (error: unknown) => console.error('Service worker registration failed:', error),
  });
  void updateSW;

  // Recover a window whose chunks were replaced underneath it.
  //
  // `skipWaiting` takes over EVERY client at once, so the moment one window
  // accepts an update the new precache is active everywhere — and the old
  // hashed chunks are gone from it and 404 from nginx, which serves only the
  // current build. Every route in this app is lazy, so any other open window
  // that then navigates somewhere it had not already visited fails its dynamic
  // import.
  //
  // With nothing listening, that rejection reaches the top-level error boundary
  // and replaces the whole app — for a user who did nothing but have a second
  // tab open. Vite fires `vite:preloadError` for exactly this, and a reload is
  // the correct answer: the new build is already the one installed.
  //
  // `preventDefault` stops the unhandled rejection so the boundary does not
  // also fire while the reload is in flight.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    console.warn('A chunk went missing, which means this window is running a superseded build. Reloading.');
    reloadKeepingDrafts(browserSessionStorage(), () => window.location.reload());
  });

  // And keep checking, whatever the app is doing. PwaUpdatePrompt polls hourly
  // while it is mounted; this interval survives a crashed render, which is
  // exactly the case where a new build matters most.
  const UPDATE_CHECK_MS: number = 60 * 60 * 1000;
  window.setInterval(() => {
    navigator.serviceWorker?.getRegistration()
      .then((registration) => registration?.update())
      .catch(() => undefined);
  }, UPDATE_CHECK_MS);

  // Before React mounts. `beforeinstallprompt` fires once, early, and cannot
  // be requested later — so capturing it must not depend on which component
  // happens to be mounted at that moment. Same reasoning as the service-worker
  // registration above.
  startInstallPromptCapture();
  startKeyboardInsetTracking();
  // Drafts carried across a reload the app asked for, back before any composer
  // mounts; and the SW-independent deploy and stale-tab checks. `import.meta.url` here is
  // the entry chunk's URL, which is what /version.json names (deployed-version.ts).
  restoreHandedOffDrafts(browserSessionStorage());
  watchThisBuild(import.meta.url);
  // A secure link and an app link, kept for after sign-in before any page reads the address.
  captureBootLinks(window.location, browserSessionStorage(), (url: string): void => {
    window.history.replaceState(window.history.state, '', url);
  });

  const root: ReturnType<typeof createRoot> = createRoot(rootElement);
  root.render(<App />);
} catch (error) {
  console.error("main.tsx: Error during initialization:", error);

  // Show error on page if React fails — use safe DOM APIs (no innerHTML)
  const rootElement: HTMLElement | null = document.getElementById("root");
  if (rootElement) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    const errorStack: string = error instanceof Error ? error.stack ?? '' : '';

    const container: HTMLDivElement = document.createElement('div');
    container.style.cssText = 'padding: 20px; color: red; font-family: monospace;';

    const heading: ReturnType<typeof document.createElement> = document.createElement('h2');
    heading.textContent = 'React Initialization Error';

    const errorParagraph: ReturnType<typeof document.createElement> = document.createElement('p');
    const errorLabel: HTMLElement = document.createElement('strong');
    errorLabel.textContent = 'Error: ';
    errorParagraph.appendChild(errorLabel);
    errorParagraph.appendChild(document.createTextNode(errorMessage));

    const stackLabel: ReturnType<typeof document.createElement> = document.createElement('p');
    const stackStrong: HTMLElement = document.createElement('strong');
    stackStrong.textContent = 'Stack:';
    stackLabel.appendChild(stackStrong);

    const stackPre: ReturnType<typeof document.createElement> = document.createElement('pre');
    stackPre.textContent = errorStack;

    container.appendChild(heading);
    container.appendChild(errorParagraph);
    container.appendChild(stackLabel);
    container.appendChild(stackPre);

    rootElement.textContent = '';
    rootElement.appendChild(container);
  }
}
