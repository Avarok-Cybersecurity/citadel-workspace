/**
 * A cut console line must not read as a complete one.
 *
 * The realtime printer cut at 150 characters. The WASM tracing formatter puts
 * `%cWARN%c`, a container-absolute source path and another `%c` in front of
 * every message, which is around 110 of those characters — so what reached CI
 * was the prefix and the first few characters of the message.
 *
 * For a stuck ILM link that produced:
 *
 *   [ILM-BLOCKED-RECOVERY] CID 15079777622326333560 -> peer 15
 *
 * The peer is `15079777622326333560`. `15` is a plausible CID, nothing marked
 * the line as cut, and a reader would have chased a peer that does not exist.
 */
import { describe, it, expect } from 'vitest';
import { formatConsoleLine, CONSOLE_LINE_LIMIT } from '../console-line.js';

const WASM_WARN: string =
  '%cWARN%c /workspace/citadel-internal-service/intersession-layer-messaging/src/lib.rs:668 %c\n' +
  '[ILM-BLOCKED-RECOVERY] CID 15079777622326333560 -> peer 15079777622326333561: ' +
  'clearing stale state after 50 consecutive blocks';

describe('a console line on its way to a CI log', () => {
  it('keeps both CIDs of the line that was being cut in half', () => {
    const line: string = formatConsoleLine(WASM_WARN);

    expect(line).toContain('15079777622326333560');
    expect(line).toContain('15079777622326333561');
  });

  it('drops the style directives, which carry nothing in a text log', () => {
    expect(formatConsoleLine(WASM_WARN)).not.toContain('%c');
  });

  it('shortens the container-absolute path but keeps the file and line', () => {
    const line: string = formatConsoleLine(WASM_WARN);

    expect(line).toContain('/src/lib.rs:668');
    expect(line).not.toContain('/workspace/citadel-internal-service/');
  });

  it('says so when it does truncate, rather than passing a fragment as whole', () => {
    // The whole point. A limit is fine; a limit you cannot see is not.
    const long: string = `[TAG] ${'x'.repeat(CONSOLE_LINE_LIMIT + 40)} tail`;
    const line: string = formatConsoleLine(long);

    expect(line).toMatch(/… \(\+\d+ chars\)$/);
  });

  it('leaves a line that fits exactly as it was', () => {
    // The negative control for the truncation marker: without this, a marker
    // appended unconditionally would pass every assertion above.
    expect(formatConsoleLine('[TAG] short and complete')).toBe('[TAG] short and complete');
  });
});
