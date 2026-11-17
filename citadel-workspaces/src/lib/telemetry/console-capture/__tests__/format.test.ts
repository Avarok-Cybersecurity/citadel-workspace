import { describe, expect, it } from 'vitest';
import { cut, fromExtension, lineFrom, MESSAGE_BYTES, STACK_BYTES, type ConsoleLine } from '../format';
import { REJECTION_TAG, WINDOW_ERROR_TAG } from '../../window-error-tags';

const bytes = (text: string): number => new TextEncoder().encode(text).length;

describe('a console call as a line', () => {
  it('takes its source from the level and from the window handlers\' tags', () => {
    expect(lineFrom('error', ['boom']).source).toBe('ConsoleError');
    expect(lineFrom('warn', ['careful']).source).toBe('ConsoleWarn');
    expect(lineFrom('error', [WINDOW_ERROR_TAG, { message: 'x is undefined', filename: 'https://app/a.js', lineno: 3, colno: 9, stack: 'at f (a.js:3:9)' }]))
      .toEqual({ source: 'WindowError', message: 'x is undefined (https://app/a.js:3:9)', stack: 'at f (a.js:3:9)' });
    const reason: Error = new TypeError('fetch failed');
    const rejected: ConsoleLine = lineFrom('error', [REJECTION_TAG, { reason, promise: Promise.resolve() }]);
    expect(rejected.source).toBe('UnhandledRejection');
    expect(rejected.message).toBe('TypeError: fetch failed');
    expect(rejected.stack).toBe(reason.stack ?? null);
  });

  it('reads strings, primitives and errors, and only names any other object', () => {
    const line: ConsoleLine = lineFrom('error', ['Failed to send', 42, null, { body: 'meet me at noon', password: 'hunter2' }, ['a', 'b']]);
    expect(line.message).toBe('Failed to send 42 null [object] [array of 2]');
    expect(line.stack).toBeNull();
  });

  it('cuts the message and the stack to their budgets', () => {
    const line: ConsoleLine = lineFrom('error', [new Error('word '.repeat(1_000))]);
    expect(bytes(line.message)).toBeLessThanOrEqual(MESSAGE_BYTES);
    expect(bytes(line.stack ?? '')).toBeLessThanOrEqual(STACK_BYTES);
    expect(line.message.endsWith(' [cut]')).toBe(true);
  });
});

describe('cutting', () => {
  it('leaves text within its budget alone', () => {
    expect(cut('short', 10)).toBe('short');
  });

  it('drops the word the cut fell in, so no part of a token survives', () => {
    const token: string = 'sk_live_' + 'A1b2C3d4'.repeat(20);
    expect(cut(`request failed with ${token}`, 64)).toBe('request failed with [cut]');
    expect(cut(token, 64)).toBe(' [cut]');
  });

  it('counts UTF-8 bytes, not code units', () => {
    const cutText: string = cut('ü'.repeat(100), 50);
    expect(bytes(cutText)).toBeLessThanOrEqual(50);
  });
});

describe('extension lines', () => {
  it.each([
    ['chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js:2:1'],
    ['moz-extension://9f1e/inject.js:1:1'],
    ['safari-web-extension://AB12/script.js:1:1'],
    ['at Grammarly.js:2:34'],
  ])('are recognised by their source: %s', (stack: string) => {
    expect(fromExtension({ source: 'WindowError', message: 'Uncaught TypeError', stack })).toBe(true);
  });

  it('and the app\'s own are not', () => {
    expect(fromExtension({ source: 'ConsoleError', message: 'boom', stack: 'at f (https://work.avarok.net/assets/index.js:1:2)' })).toBe(false);
  });
});
