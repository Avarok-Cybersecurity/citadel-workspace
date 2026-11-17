/**
 * The captured `beforeinstallprompt` event, held outside React.
 *
 * Chromium fires this ONCE per page load, early, and it cannot be requested
 * later — the only way to show an install dialog is to replay the event you
 * caught. It used to be stashed in `useState` inside `usePwaInstall`, with the
 * listener registered in that instance's mount effect. Every consumer therefore
 * had its own listener and its own copy.
 *
 * That broke the ordinary journey. The event fires while the user is on the
 * landing page; signing in unmounts Landing, taking its stashed event with it,
 * and mounts the TopBar consumer *after* the event has already fired. So the
 * user-menu install entry — added precisely because installing was only offered
 * on the landing page — could never appear for anyone who had signed in.
 *
 * Registered at import time from `main.tsx`, before React mounts, for the same
 * reason service-worker registration lives there: nothing that must not be
 * missed should depend on a component being mounted at the right moment.
 */
import { notifyEach } from '@/lib/notify-listeners';
import { debugLog } from '@/lib/debug-config';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

let promptEvent: BeforeInstallPromptEvent | null = null;
let installed: boolean = false;
const listeners: Set<() => void> = new Set<() => void>();

function emit(): void {
  notifyEach(listeners, 'install-prompt-store');
}

export function subscribeToInstallState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPromptEvent(): BeforeInstallPromptEvent | null {
  return promptEvent;
}

export function isAppInstalled(): boolean {
  // Read live rather than trusting a value captured at start-up. Launching an
  // already-installed copy can flip display-mode without a reload, and a cached
  // `false` would keep offering an install to someone already inside the app.
  // A boolean compares by value, so this is safe as a `useSyncExternalStore`
  // snapshot.
  return installed || detectStandalone();
}

export function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // `display-mode: standalone` covers Chromium/Firefox; `navigator.standalone`
  // is the iOS Safari equivalent, which does not implement the media query.
  const iosStandalone: boolean = (window.navigator as { standalone?: boolean }).standalone === true;
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone;
}

/** Consume the event. It is single-use whichever way the user answers. */
export function clearPromptEvent(): void {
  promptEvent = null;
  emit();
}

let started: boolean = false;

/** Idempotent: safe to call from module scope and from a test. */
export function startInstallPromptCapture(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('beforeinstallprompt', (event: Event) => {
    // Suppress the automatic mini-infobar so the app controls placement.
    event.preventDefault();
    promptEvent = event as BeforeInstallPromptEvent;
    debugLog('PWA', 'Install prompt available');
    emit();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    promptEvent = null;
    debugLog('PWA', 'App installed');
    emit();
  });

  // Launching an already-installed copy changes display-mode without a reload.
  window
    .matchMedia('(display-mode: standalone)')
    .addEventListener('change', (e: MediaQueryListEvent) => {
      installed = e.matches;
      emit();
    });
}

/** Test seam: forget everything captured so far. */
export function resetInstallPromptCaptureForTests(): void {
  promptEvent = null;
  installed = false;
  started = false;
  listeners.clear();
}
