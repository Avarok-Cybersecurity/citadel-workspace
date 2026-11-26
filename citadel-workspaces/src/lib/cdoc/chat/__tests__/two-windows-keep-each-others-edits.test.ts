/**
 * One member, one chat document open in two windows of the same browser: both windows' edits
 * are kept on the device and shown in both windows. The windows share the agent's LocalDB, so
 * a write that replaces the stored copy with one window's own would erase the other's edits,
 * and a window that never hears the other's write shows (and later folds) a copy without them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { typeInto, snapshotText } from '../../collab/__tests__/doubles/real-replicas';
import { CHAT_SYNC, type ChatSyncConfig } from '../chat-config';
import { localChatTransport } from '../chat-local-transport';
import { newBrowser, openWindow, type Browser, type BrowserWindow, type OpenDocument } from './doubles/browser-windows';
import { ALICE, BLANK } from './doubles/chat-pair';

const SCRATCH: string = 'scratch-doc-two-windows';
let browser: Browser = newBrowser();

afterEach((): void => {
  browser.shut();
  browser = newBrowser();
});

/** A scratchpad document Alice already keeps on this device, open in two new windows. */
async function twoWindows(config: ChatSyncConfig): Promise<{ readonly a: OpenDocument; readonly b: OpenDocument }> {
  const first: BrowserWindow = await openWindow(browser, ALICE, null);
  const created: OpenDocument = await first.open(SCRATCH, localChatTransport(ALICE), BLANK, config);
  await created.close();
  const a: OpenDocument = await (await openWindow(browser, ALICE, null)).open(SCRATCH, localChatTransport(ALICE), BLANK, config);
  const b: OpenDocument = await (await openWindow(browser, ALICE, null)).open(SCRATCH, localChatTransport(ALICE), BLANK, config);
  return { a, b };
}

async function reopened(): Promise<string> {
  const again: OpenDocument = await (await openWindow(browser, ALICE, null)).open(SCRATCH, localChatTransport(ALICE), BLANK, CHAT_SYNC);
  const text: string = await snapshotText(again.editor());
  await again.close();
  return text;
}

describe('a chat document open in two windows', () => {
  it('keeps both windows\' edits on the device, whichever writes last', async () => {
    const { a, b } = await twoWindows(CHAT_SYNC);
    await typeInto(a.editor(), 'alpha-from-A');
    await typeInto(b.editor(), 'bravo-from-B');
    await a.close();
    await b.close();
    const text: string = await reopened();
    expect(text).toContain('alpha-from-A');
    expect(text).toContain('bravo-from-B');
    expect([...a.problems, ...b.problems]).toEqual([]);
  });

  it('shows each window the other\'s edits once they are written', async () => {
    const { a, b } = await twoWindows(CHAT_SYNC);
    await typeInto(a.editor(), 'alpha-from-A');
    await typeInto(b.editor(), 'bravo-from-B');
    browser.clock.advance(CHAT_SYNC.storeAfterIdleMs);
    await vi.waitFor(async (): Promise<void> => {
      expect(await snapshotText(a.editor())).toContain('bravo-from-B');
      expect(await snapshotText(b.editor())).toContain('alpha-from-A');
    });
    await a.close();
    await b.close();
    expect([...a.problems, ...b.problems]).toEqual([]);
  });

  it('keeps the other window\'s fold: a window writing after it brings that snapshot in first', async () => {
    // Every write folds, so each window's write replaces the stored snapshot.
    const folding: ChatSyncConfig = { ...CHAT_SYNC, foldAfterUpdates: 1 };
    const { a, b } = await twoWindows(folding);
    await typeInto(a.editor(), 'alpha-from-A');
    await a.close();
    await vi.waitFor(async (): Promise<void> => {
      expect(await snapshotText(b.editor())).toContain('alpha-from-A');
    });
    await typeInto(b.editor(), 'bravo-from-B');
    await b.close();
    const text: string = await reopened();
    expect(text).toContain('alpha-from-A');
    expect(text).toContain('bravo-from-B');
    expect([...a.problems, ...b.problems]).toEqual([]);
  });
});
