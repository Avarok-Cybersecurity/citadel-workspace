/**
 * Pressing PrintScreen with a direct chat open sends that peer a screenshot
 * notice. The sender is injected, so this asserts on what would be sent
 * without mocking the messenger module.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { useScreenshotNotice } from '../useScreenshotNotice';

afterEach(() => cleanup());

function press(key: string, code: string): void {
  act((): void => { window.dispatchEvent(new KeyboardEvent('keyup', { key, code })); });
}

describe('useScreenshotNotice', () => {
  it('tells the open conversation\'s peer about a PrintScreen', () => {
    const sent: bigint[] = [];
    renderHook(() => useScreenshotNotice(42n, async (peer: bigint): Promise<void> => { sent.push(peer); }));
    press('PrintScreen', 'PrintScreen');
    expect(sent).toEqual([42n]);
  });

  it('sends nothing for other keys', () => {
    const sent: bigint[] = [];
    renderHook(() => useScreenshotNotice(42n, async (peer: bigint): Promise<void> => { sent.push(peer); }));
    press('a', 'KeyA');
    expect(sent).toEqual([]);
  });

  it('sends nothing without a direct peer (a group chat)', () => {
    const sent: bigint[] = [];
    renderHook(() => useScreenshotNotice(null, async (peer: bigint): Promise<void> => { sent.push(peer); }));
    press('PrintScreen', 'PrintScreen');
    expect(sent).toEqual([]);
  });

  it('stops listening once the chat closes', () => {
    const sent: bigint[] = [];
    const { unmount } = renderHook(() => useScreenshotNotice(42n, async (peer: bigint): Promise<void> => { sent.push(peer); }));
    unmount();
    press('PrintScreen', 'PrintScreen');
    expect(sent).toEqual([]);
  });
});
