/**
 * The creator's edits reach the peer even when the creator's document view opened twice (the
 * view re-mounts, so a second keeper opens while the first is closing). The first keeper's
 * closing write stores a snapshot the second does not hold, which the second brings in. One cdoc
 * runtime holds ONE editor: a replica opened over that snapshot in the shown view's runtime
 * replaced the shown replica there, so the creator's own typing vanished from it and the peer,
 * answered from it, never received that typing (integration test:live-doc, user1ToUser2Sync).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { snapshotText, typeInto } from '../../collab/__tests__/doubles/real-replicas';
import { CHAT_SYNC } from '../chat-config';
import { newBrowser, openWindow, type Browser, type BrowserWindow, type OpenDocument } from './doubles/browser-windows';
import { ALICE, BLANK, BOB } from './doubles/chat-pair';
import { CLEAN, FakeChannel } from './doubles/fake-channel';
import { Rng } from './doubles/rng';

const DOC_ID: string = 'chat-doc-creator-view-twice';
const browsers: Browser[] = [];

afterEach((): void => {
  for (const browser of browsers.splice(0)) browser.shut();
});

function browser(): Browser {
  const made: Browser = newBrowser();
  browsers.push(made);
  return made;
}

/** Runs both people's time and the channel until nothing has moved for a while. */
async function exchange(channel: FakeChannel, people: readonly Browser[]): Promise<void> {
  const rng: Rng = new Rng(7);
  let quiet: number = 0;
  for (let round: number = 0; round < 200 && quiet < 8; round += 1) {
    for (const person of people) person.clock.advance(CHAT_SYNC.updateCoalesceMs);
    for (let turn: number = 0; turn < 3; turn += 1) await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 0); });
    const arrived: number = channel.deliver(rng, CLEAN);
    quiet = arrived === 0 && channel.inFlightCount === 0 ? quiet + 1 : 0;
  }
}

describe('a chat document whose creator\'s view opened twice', () => {
  it('still gives the peer what the creator typed, and keeps it on the creator\'s screen', async () => {
    const channel: FakeChannel = new FakeChannel();
    const alices: Browser = browser();
    const bobs: Browser = browser();
    const alice: BrowserWindow = await openWindow(alices, ALICE, null);
    const first: OpenDocument = await alice.open(DOC_ID, channel.transport(ALICE, BOB), BLANK, CHAT_SYNC);
    const second: OpenDocument = await alice.open(DOC_ID, channel.transport(ALICE, BOB), BLANK, CHAT_SYNC);
    await typeInto(second.editor(), 'typed-by-alice');
    // The first view goes: its closing write stores the new document, which the second brings in.
    await first.close();
    await exchange(channel, [alices]);
    await vi.waitFor(async (): Promise<void> => {
      expect(await alice.store.loadBase(DOC_ID)).not.toBeNull();
    });
    expect(await snapshotText(second.editor())).toContain('typed-by-alice');
    const bob: OpenDocument = await (await openWindow(bobs, BOB, null)).open(DOC_ID, channel.transport(BOB, ALICE), BLANK, CHAT_SYNC);
    await exchange(channel, [alices, bobs]);
    expect(await snapshotText(bob.editor())).toContain('typed-by-alice');
    expect([...first.problems, ...second.problems, ...bob.problems]).toEqual([]);
    await second.close();
    await bob.close();
  });
});
