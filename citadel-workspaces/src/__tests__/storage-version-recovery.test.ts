/**
 * The screen a user reaches when their stored data is newer than the build.
 *
 * Two causes, one screen, and only one safe answer:
 *
 *   stale cached bundle  — unregister the worker and reload; the data is fine
 *   genuine rollback     — the server is deliberately serving the older build,
 *                          so every reload returns it, for ever
 *
 * The screen offered only the reload, so a rolled-back deployment left the user
 * pressing a button that could not work with their data unreachable. The
 * destructive option appears only after the safe one has been tried and landed
 * back here — which is exactly the signal that separates the two causes.
 */

import { describe, it, expect, beforeEach, vi   } from 'vitest';
import { showStorageVersionRecovery } from '../storage-version-recovery';

const RELOAD_ATTEMPTED_KEY: "citadel-storage-version-reload-attempted" = 'citadel-storage-version-reload-attempted';

function freshRoot(): HTMLElement {
  document.body.innerHTML = '<div id="root"></div>';
  return document.getElementById('root') as HTMLElement;
}

const buttonLabels = (): string[] =>
  [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');

describe('the storage-version recovery screen', () => {
  beforeEach(() => {
    sessionStorage.clear();
    freshRoot();
  });

  it('offers only the safe option on first arrival', () => {
    showStorageVersionRecovery();

    expect(buttonLabels()).toEqual(['Get the current version']);
  });

  it('offers a reset once reloading has already been tried', () => {
    sessionStorage.setItem(RELOAD_ATTEMPTED_KEY, '1');
    showStorageVersionRecovery();

    expect(buttonLabels()).toContain('Reset local data on this device');
  });

  it('says what the reset destroys, and what it does not', () => {
    sessionStorage.setItem(RELOAD_ATTEMPTED_KEY, '1');
    showStorageVersionRecovery();

    const text: string = document.body.textContent ?? '';
    expect(text).toMatch(/stored in this browser/i);
    expect(text, 'a destructive action must say what survives it').toMatch(
      /not affected|are not affected/i,
    );
  });

  it('announces itself, since it replaces the whole app', () => {
    showStorageVersionRecovery();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('renders once, not once per rejected promise', () => {
    // Every failed getDB() rejects, and there are many on boot.
    showStorageVersionRecovery();
    showStorageVersionRecovery();
    showStorageVersionRecovery();

    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('records the attempt before reloading, or the escalation never appears', () => {
    showStorageVersionRecovery();
    const reload: ReturnType<typeof vi.fn> = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload },
      writable: true,
    });

    (document.querySelector('button') as HTMLButtonElement).click();

    expect(sessionStorage.getItem(RELOAD_ATTEMPTED_KEY)).toBe('1');
  });
});
