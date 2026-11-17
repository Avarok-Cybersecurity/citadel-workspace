import { describe, it, expect } from 'vitest';
import { shouldSendOnKey } from '../should-send-on-key';

const key: (over?: Partial<{ key: string; shiftKey: boolean; isComposing: boolean; }>) => { key: string; shiftKey: boolean; nativeEvent: { isComposing: boolean; }; } = (over: Partial<{ key: string; shiftKey: boolean; isComposing: boolean }> = {}): { key: string; shiftKey: boolean; nativeEvent: { isComposing: boolean; }; } => ({
  key: over.key ?? 'Enter',
  shiftKey: over.shiftKey ?? false,
  nativeEvent: { isComposing: over.isComposing ?? false },
});

describe('shouldSendOnKey', () => {
  it('sends on a plain Enter', () => {
    expect(shouldSendOnKey(key())).toBe(true);
  });

  it('does not send on Shift+Enter, which inserts a newline', () => {
    expect(shouldSendOnKey(key({ shiftKey: true }))).toBe(false);
  });

  it('does not send while an IME composition is open', () => {
    // The whole point. Enter here means "I pick this character", and sending
    // fires off a half-composed message — every single time, for anyone typing
    // Japanese, Chinese or Korean.
    expect(shouldSendOnKey(key({ isComposing: true }))).toBe(false);
  });

  it('is not fooled by Shift being held during composition either', () => {
    expect(shouldSendOnKey(key({ isComposing: true, shiftKey: true }))).toBe(false);
  });

  it('ignores other keys', () => {
    expect(shouldSendOnKey(key({ key: 'a' }))).toBe(false);
    expect(shouldSendOnKey(key({ key: 'Escape' }))).toBe(false);
  });
});
