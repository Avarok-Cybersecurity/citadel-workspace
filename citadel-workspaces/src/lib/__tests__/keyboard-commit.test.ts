/**
 * The composition clause, stated once so it can be tested once.
 */

import { describe, it, expect } from 'vitest';
import { isEnterCommit } from '../keyboard-commit';
import { shouldSendOnKey } from '@/components/chat/should-send-on-key';

const key: (k: string, isComposing?: boolean) => { key: string; nativeEvent: { isComposing: boolean; }; } = (k: string, isComposing = false): { key: string; nativeEvent: { isComposing: boolean; }; } => ({ key: k, nativeEvent: { isComposing } });

describe('isEnterCommit', () => {
  it('commits on Enter', () => {
    expect(isEnterCommit(key('Enter'))).toBe(true);
  });

  it('does not commit while an IME candidate window is open', () => {
    // The whole point: Enter here CONFIRMS the character being composed.
    expect(isEnterCommit(key('Enter', true))).toBe(false);
  });

  it('ignores other keys', () => {
    expect(isEnterCommit(key('a'))).toBe(false);
    expect(isEnterCommit(key('Escape'))).toBe(false);
  });
});

describe('shouldSendOnKey', () => {
  it('still treats Shift+Enter as a newline, not a send', () => {
    expect(shouldSendOnKey({ ...key('Enter'), shiftKey: true })).toBe(false);
    expect(shouldSendOnKey({ ...key('Enter'), shiftKey: false })).toBe(true);
  });

  it('inherits the composition rule rather than restating it', () => {
    expect(shouldSendOnKey({ ...key('Enter', true), shiftKey: false })).toBe(false);
  });
});
