/**
 * The reconnect budget must be per-outage, and the modal must close on success.
 *
 * `maxRetries` reads as a per-outage budget, but `reset` was never called — the
 * destructure omitted it — so the attempt count accumulated across the tab's
 * entire lifetime. After ten failures spread over hours, every subsequent
 * disconnection opened a modal reading "Failed to reconnect after 10 attempts"
 * with Retry already disabled and no recovery but a reload. Even before
 * exhaustion, each outage inherited the previous count and started at an
 * inflated backoff.
 *
 * Separately, the close-on-success listener waited for `connection-success`,
 * which NOTHING emits — the socket layer emits `on-ws-connection-success` — so a
 * connection recovered by any other path never closed the modal.
 *
 * Asserted on the source with comments stripped, and cross-checked against the
 * emitter: a listener naming an event nobody fires is exactly the defect here,
 * so the test must confirm the name exists on the other side too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

const modal: string = stripComments(
  readFileSync(join(process.cwd(), 'src/components/ConnectionRetryModal.tsx'), 'utf8')
);

/** Every event name the websocket layer actually emits. */
function emittedEvents(): Set<string> {
  const dir: string = join(process.cwd(), 'src/lib/websocket');
  const names: Set<string> = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src: string = readFileSync(join(dir, file), 'utf8');
    for (const m of src.matchAll(/emit\('([\w:-]+)'/g)) names.add(m[1]!);
  }
  return names;
}

describe('the reconnect modal', () => {
  it('listens for an event that is actually emitted', () => {
    const listened: string | undefined = modal.match(/useEventListener\('([\w:-]+)'/)?.[1];

    expect(listened).toBeDefined();
    expect(
      emittedEvents(),
      `the modal listens for '${listened}', which the websocket layer never emits`
    ).toContain(listened!);
  });

  it('actually destructures reset from useRetry', () => {
    // It was omitted, so `reset` existed and could never be called.
    expect(modal).toMatch(/reset:\s*\w+,?\s*\n?\s*\} = useRetry/);
  });

  it('calls that reset inside the success listener, not merely near it', () => {
    // The previous version of this test sliced 200 characters after
    // `useEventListener(` and matched /reset/i. That matched the DEPENDENCY
    // ARRAY — `[onClose, resetAttempts]` — so deleting `resetAttempts()` from
    // the callback body left every test green while the budget went back to
    // accumulating across the tab's whole lifetime. Verified by reinstating the
    // bug: three passes.
    const bound: string | undefined = /reset:\s*(\w+)/.exec(modal)?.[1];
    expect(bound, 'reset is not destructured from useRetry at all').toBeDefined();

    // The callback body only: from the arrow that opens it to its closing
    // brace, which is where the dependency array starts.
    const listenerStart: number = modal.indexOf("useEventListener('on-ws-connection-success'");
    expect(listenerStart, 'the success listener is gone').toBeGreaterThan(-1);
    const bodyStart: number = modal.indexOf('=> {', listenerStart);
    const bodyEnd: number = modal.indexOf('}, [', bodyStart);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    const body: string = modal.slice(bodyStart, bodyEnd);

    expect(
      body,
      `the listener does not call ${bound}(), so the retry budget is never reset`,
    ).toContain(`${bound}()`);
  });
});
