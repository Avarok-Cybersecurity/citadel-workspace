/**
 * The one screenshot signal a web page receives: the PrintScreen key.
 *
 * On Windows the browser sees only its keyup (the OS takes the keydown), on
 * Linux both, so callers listen for keyup. `code` is checked as well as `key`
 * because some layouts report the key as 'Unidentified'.
 *
 * Nothing else is detectable. macOS's Cmd+Shift+3/4/5 is handled by the system
 * before the page sees it, phones give a page no signal at all, and Win+Shift+S,
 * external tools and a camera pointed at the screen are invisible. See
 * a-screenshot-notice-is-best-effort-and-says-so.test.ts.
 */

/** Shown beside the setting, so it promises no more than this catches. */
export const SCREENSHOT_ALERT_LIMITS: string =
  "Best effort: only catches the PrintScreen key on Windows and Linux, while the chat is open. " +
  "macOS and phone screenshots, snipping tools and other apps can't be detected by a web page.";

export function isScreenshotKey(event: { key: string; code: string }): boolean {
  return event.key === 'PrintScreen' || event.code === 'PrintScreen';
}
