/**
 * An app's notice says who it is from only when the server said so: the author of a change from
 * their own namespace that the server told this install of. A name the app gives is never shown.
 * Real port and ledger; the sink is the page's list, recorded.
 */
import { describe, it, expect } from 'vitest';
import { badgedNotifyPort, type AppNoticeEntry } from '../first-party-ports';
import { toldAuthors, TOLD_MAX, type ToldAuthors } from '../told-authors';
import type { NotifyAbout } from '../../sdk/generated/NotifyAbout';
import type { NotifyPort } from '../../host/ports';

const about = (author: string, key: string = 'cal/ev/1'): NotifyAbout => ({ node_id: 'n', author, key });

function rig(): { told: ToldAuthors; lines: () => (string | null)[]; notify: (about?: NotifyAbout) => void } {
  const told: ToldAuthors = toldAuthors();
  const seen: AppNoticeEntry[] = [];
  const port: NotifyPort = badgedNotifyPort({ id: 'net.avarok.calendar', name: 'Calendar', nodeId: 'n' }, (n: AppNoticeEntry): void => { seen.push(n); }, told.authorOf);
  return {
    told,
    lines: (): (string | null)[] => seen.map((n: AppNoticeEntry) => n.senderLine),
    notify: (a?: NotifyAbout): void => { void port.Notify({ title: 'Invitation: Salary review', body: 'Friday', kind: 'invitation', about: a }); },
  };
}

describe('who an app notice is from', () => {
  it('is never a name the app gives', () => {
    const r: ReturnType<typeof rig> = rig();
    r.notify(about('mallory'));
    expect(r.lines()).toEqual(['Calendar: new invitation']);
  });

  it('is the author of a change the server told this install of, from their own namespace', () => {
    const r: ReturnType<typeof rig> = rig();
    r.told.heard({ node_authored: { node_id: 'n', author: 'alice' } }, 'cal/ev/1');
    r.notify(about('alice'));
    expect(r.lines()).toEqual(['Calendar: new invitation from alice']);
  });

  it('is no one when the app points at a told change under another name', () => {
    const r: ReturnType<typeof rig> = rig();
    r.told.heard({ node_authored: { node_id: 'n', author: 'alice' } }, 'cal/ev/1');
    r.notify(about('mallory'));
    expect(r.lines()).toEqual(['Calendar: new invitation']);
  });

  it('is no one for a change in a node\'s shared store, which names no author', () => {
    const r: ReturnType<typeof rig> = rig();
    r.told.heard({ node: { node_id: 'n' } }, 'cal/ev/1');
    r.notify(about('alice'));
    expect(r.lines()).toEqual(['Calendar: new invitation']);
  });

  it('is forgotten past the bound', () => {
    const r: ReturnType<typeof rig> = rig();
    r.told.heard({ node_authored: { node_id: 'n', author: 'alice' } }, 'cal/ev/0');
    for (let i: number = 1; i <= TOLD_MAX; i += 1) r.told.heard({ node_authored: { node_id: 'n', author: 'bo' } }, `cal/ev/${i}`);
    r.notify(about('alice', 'cal/ev/0'));
    expect(r.lines()).toEqual(['Calendar: new invitation']);
  });

  it('says what the notice is about, and writes no line for the app\'s own notice, which names no kind', () => {
    const seen: AppNoticeEntry[] = [];
    const port: NotifyPort = badgedNotifyPort({ id: 'x', name: 'Calendar', nodeId: 'n' }, (n: AppNoticeEntry): void => { seen.push(n); }, toldAuthors().authorOf);
    void port.Notify({ title: 't', body: 'b', kind: 'poll' });
    void port.Notify({ title: 't', body: 'b', kind: 'booking' });
    void port.Notify({ title: 't', body: 'b', kind: 'other' });
    void port.Notify({ title: 't', body: 'b' });
    expect(seen.map((n: AppNoticeEntry) => n.senderLine)).toEqual(['Calendar: new poll', 'Calendar: new booking', 'Calendar: new notice', null]);
  });
});
