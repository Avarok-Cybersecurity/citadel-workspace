/**
 * `debugLog` becomes a `noop` in production — but the call sites remain and
 * THEIR ARGUMENTS ARE STILL EVALUATED. With 1,000-plus of them that is several
 * KB on a phone's first paint, and worse than dead bytes: one call recursively
 * stringifies the serialized session store on every write, in production, to
 * feed a function that throws the result away.
 *
 * esbuild's `pure` list is what lets the minifier drop the call and its
 * arguments together. The list is comment-stripped before matching because the
 * config now explains `debugLog` in prose — an assertion that matched the
 * explanation would pass on a config that had lost the entry.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/test-utils/strip-comments';

const config: string = stripComments(readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8'));

/** The `pure: [...]` array as written, comments already removed. */
const pureList: string = /pure:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? '';

describe('production logging', () => {
  it('marks debugLog pure so its calls and arguments are removable', () => {
    expect(pureList, 'the pure list is gone from vite.config.ts').not.toBe('');
    expect(pureList).toContain("'debugLog'");
  });

  it('does NOT mark errorLog or warnLog pure', () => {
    // A render crash is the one error a user cannot report themselves, so it
    // must survive minification.
    expect(pureList).not.toContain('errorLog');
    expect(pureList).not.toContain('warnLog');
    expect(pureList).not.toContain('console.error');
    expect(pureList).not.toContain('console.warn');
  });

  it('keeps debugLog a no-op at runtime as well', () => {
    // Belt and braces: `pure` only helps the production build. The runtime
    // guard is what makes a dev-only log dev-only in every other context.
    const source: string = readFileSync(join(process.cwd(), 'src/lib/debug-config.ts'), 'utf8');
    expect(source).toMatch(/isDev\s*\?/);
    expect(source).toContain('noop');
  });

  it('does not swallow subscriber exceptions into a stripped call', () => {
    // event-emitter's catch used `debugLog`, which is on the pure list above --
    // so in every production build the minifier dropped the call and its
    // argument, and an exception thrown by any of the ~156 event subscribers
    // vanished. The remaining subscribers still ran, leaving the app
    // half-updated with nothing to find afterwards.
    //
    // Asserted on the source rather than the built bundle because the pure
    // list is what does the dropping, and it is already read above.
    const emitter: string = stripComments(
      readFileSync(join(process.cwd(), 'src/lib/event-emitter.ts'), 'utf8'),
    );
    // Anchored on the log line itself: a `catch { ... }` body cannot be matched
    // with a naive brace regex here, because the message is a template literal
    // containing `${event}`.
    const caught: string =
      emitter.split('\n').find((l) => l.includes('Error in event handler')) ?? '';
    expect(caught, 'the handler-error log line in event-emitter.ts is gone').not.toBe('');
    expect(
      caught,
      'a subscriber exception is logged with a call the production minifier removes',
    ).not.toContain('debugLog(');
    expect(caught).toContain('errorLog(');
  });
});
