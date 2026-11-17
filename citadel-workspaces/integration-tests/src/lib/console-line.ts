/**
 * One line of browser console output, as it appears in a CI log.
 *
 * The realtime printer cut at `text.substring(0, 150)`, and what reached the
 * log was this:
 *
 *   ⚠️ [WARNING] %cWARN%c /workspace/citadel-internal-service/…/src/lib.rs:668 %c
 *   [ILM-BLOCKED-RECOVERY] CID 15079777622326333560 -> peer 15
 *
 * The peer is `15079777622326333560`. What the log says is `15`, and `15` is a
 * plausible-looking value — small CIDs exist. A reader chasing a stuck link
 * would have started from a peer id that does not exist, and nothing in the
 * line says it was cut.
 *
 * Two separate faults, so two fixes:
 *
 *   1. The budget was being spent on the formatter's prefix rather than on the
 *      message. `%c` style directives carry no information in a plain-text log,
 *      and the source path is a container-absolute path whose first four
 *      segments are the same on every line. Both are trimmed BEFORE the limit.
 *   2. A cut line now says it was cut. A truncated diagnostic that reads as
 *      complete is worse than no diagnostic.
 */

/** Room for a message once the prefix is gone. Wide enough for two u64 CIDs. */
export const CONSOLE_LINE_LIMIT: number = 300;

/**
 * Strip what carries no information in a text log, then truncate visibly.
 *
 * @param text  the raw `msg.text()` from Playwright
 * @param limit characters of message to keep
 */
export function formatConsoleLine(text: string, limit: number = CONSOLE_LINE_LIMIT): string {
  const withoutStyles: string = text.replace(/%c/g, '');
  // `/workspace/citadel-internal-service/intersession-layer-messaging/src/lib.rs:657`
  // becomes `…/src/lib.rs:657`. The crate is already named by the target.
  const shortPaths: string = withoutStyles.replace(
    /(?:\/[\w.-]+){3,}(\/src\/[\w./-]+:\d+)/g,
    '…$1',
  );
  const collapsed: string = shortPaths.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= limit) return collapsed;
  const dropped: number = collapsed.length - limit;
  return `${collapsed.slice(0, limit)}… (+${dropped} chars)`;
}
