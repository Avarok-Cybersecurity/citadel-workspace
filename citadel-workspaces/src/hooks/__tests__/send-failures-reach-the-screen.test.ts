/**
 * The subscriber has to be MOUNTED, not merely written.
 *
 * `lib/p2p/send-failure.ts` detects the agent's `MessageSendFailure`, builds a
 * reason a person can act on, and throttles repeats — then emits an event its
 * own comment calls "an event a surface can render". Nothing rendered it, so a
 * message that failed to send sat in the thread looking sent.
 *
 * The sibling test `send-failure-reaches-the-handler` already carries the
 * lesson in its header: "The consumer has to be WIRED, not merely written." It
 * was written about the WebSocket handler calling the reader. The handler was
 * wired. The surface was not. The fix was applied to one end of the feature.
 *
 * Why a source assertion rather than the event gate:
 * `check-event-listeners-have-emitters` is satisfied by an `eventEmitter.on`
 * appearing anywhere in `src/`, so a hook that subscribes and is never called
 * passes it — verified by commenting the call out of App.tsx and watching the
 * gate stay green. That gate answers "does a subscriber exist"; this answers
 * "is it reachable", which is the question that was actually wrong.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Source with comments blanked, so a mention cannot stand in for a call. */
function code(relative: string): string {
  return readFileSync(join(process.cwd(), relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('a P2P send failure', () => {
  it('has a subscriber that turns it into something on screen', () => {
    const hook: string = code('src/hooks/use-send-failure-toasts.ts');

    expect(hook, 'the hook no longer subscribes to the failure event').toMatch(
      /eventEmitter\.on\(\s*['"]p2p:send-failed['"]/,
    );
    expect(hook, 'subscribing without rendering leaves the user with nothing').toMatch(
      /\btoast\s*\(/,
    );
  });

  it('is mounted by the app, not merely defined', () => {
    // The half that the event gate cannot see.
    const app: string = code('src/App.tsx');

    expect(app, 'App does not import the send-failure subscriber').toMatch(
      /useSendFailureToasts/,
    );
    expect(app, 'App imports the hook but never calls it, so nothing subscribes').toMatch(
      /^\s*useSendFailureToasts\(\);/m,
    );
  });

  it('still emits the event the subscriber listens for', () => {
    // Both ends, asserted together. Either alone is the defect.
    const reporter: string = code('src/lib/p2p/send-failure.ts');
    expect(reporter).toMatch(/emit\(\s*['"]p2p:send-failed['"]/);
  });
});
