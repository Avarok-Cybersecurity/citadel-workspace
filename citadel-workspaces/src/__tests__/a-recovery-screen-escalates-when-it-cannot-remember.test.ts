/**
 * The recovery screen decides to offer the destructive reset by finding, after a
 * reload, a marker the first click wrote to sessionStorage. Where sessionStorage
 * refuses the write (strict privacy settings throw), the marker never exists, so
 * the reload landed on the same screen and offered "Get the current version"
 * for ever, with the way out never shown.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showStorageVersionRecovery } from '../storage-version-recovery';

const buttonLabels = (): string[] =>
  [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');

beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; });
afterEach(() => { vi.restoreAllMocks(); });

describe('the recovery screen where sessionStorage refuses writes', () => {
  it('offers the reset at once instead of a reload that cannot be remembered', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((): void => { throw new DOMException('denied', 'SecurityError'); });
    const reload: ReturnType<typeof vi.fn> = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    showStorageVersionRecovery();

    (document.querySelector('button') as HTMLButtonElement).click();

    expect(buttonLabels()).toContain('Reset local data on this device');
    expect(reload).not.toHaveBeenCalled();
  });
});
