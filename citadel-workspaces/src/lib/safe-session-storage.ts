/**
 * `sessionStorage` that cannot take the app down.
 *
 * The accessor is not always there to be read. Strict privacy settings,
 * enterprise policy and some embedded contexts make `window.sessionStorage`
 * THROW rather than return null — and several callers here run during boot.
 *
 * Measured with a throwing `sessionStorage`: the app did not mount, did not
 * reach the root error boundary, and rendered an empty body with a
 * `SecurityError` in the console. A blank page is worse than a crash screen,
 * because there is nothing on screen to report.
 *
 * `localStorage` is wrapped at every site in this codebase. Its sibling was
 * wrapped at none. One module rather than six try/catch blocks, so the next
 * caller inherits the guard instead of re-deciding it.
 *
 * Reads answer `null` when storage is unavailable, which is what an empty
 * store answers too — every caller already handles that. Writes are dropped,
 * silently and deliberately: a session-scoped preference is not worth an
 * interruption, and there is nothing the user could do about it.
 */
export function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function sessionSet(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function sessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing to remove from a store that cannot be reached.
  }
}
