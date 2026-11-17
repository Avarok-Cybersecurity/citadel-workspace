/**
 * What the Calendar tells a member about others' changes it hears while one of their windows is
 * open (the kernel's StorageChanged, which reaches every session that may view the node): an
 * event someone else made with them invited, a booking with them that its host cancelled, and a
 * poll opened on a page they can see. Each is told once: a marker in the member's own storage
 * (`cal/told/...`) is written before it is raised, so another save of the same event or poll, or a
 * second window hearing the same change, says nothing again.
 *
 * `noticeOf*` are pure; `tellAbout` reads the changed key with the member's own rights.
 */
import type { StorageChange } from '@/lib/citadel-apps/host/glue-instance';
import type { CalendarEngine } from './engine/calendar-engine';
import type { Event } from './generated/Event';
import type { Poll } from './generated/Poll';
import type { NoticeKind } from './notify-prefs';
import { POLL_PREFIX } from './polls';
import type { CalendarPorts, CalendarStore } from './ports';
import { EVENT_PREFIX } from './read-sources';

export interface Notice {
  readonly kind: NoticeKind;
  /** Where the marker that it was told is kept, under `cal/told/`. */
  readonly told: string;
  readonly title: string;
  readonly body: string;
}

export const TOLD_PREFIX: string = 'cal/told/';

type Watched = { readonly what: 'poll' | 'event'; readonly store: CalendarStore; readonly key: string; readonly node: string };

/** The change, when it is one a member may be told about: an event anywhere, a poll in someone else's namespace. */
export function watchedOf(change: StorageChange, me: string): Watched | null {
  const { backend, key } = change;
  if (typeof backend !== 'object') return null;
  if ('node' in backend) {
    return key.startsWith(EVENT_PREFIX) ? { what: 'event', store: { kind: 'node', node: backend.node.node_id }, key, node: backend.node.node_id } : null;
  }
  const { node_id: node, author } = backend.node_authored;
  if (author === me) return null;
  const store: CalendarStore = { kind: 'authored', node, author };
  if (key.startsWith(EVENT_PREFIX)) return { what: 'event', store, key, node };
  if (key.startsWith(POLL_PREFIX)) return { what: 'poll', store, key, node };
  return null;
}

const invites = (event: Event, me: string): boolean => event.invitees.some((i) => 'member' in i && i.member.username === me);

/** `when`: the event's start as the member reads it. */
export function noticeOfEvent(event: Event, me: string, when: string, nodeName: string): Notice | null {
  if (event.author === me || !invites(event, me)) return null;
  const booking: boolean = typeof event.kind === 'object';
  if (booking) {
    if (event.status === 'confirmed' || event.status.cancelled.by === me) return null;
    const why: string = event.status.cancelled.reason === null ? '' : `: ${event.status.cancelled.reason}`;
    return { kind: 'bookings', told: `cancel/${event.id}`, title: 'Booking cancelled', body: `${event.title} (${when}) was cancelled by ${event.status.cancelled.by}${why}` };
  }
  if (event.status !== 'confirmed') return null;
  return { kind: 'invitations', told: `invite/${event.id}`, title: `Invited: ${event.title}`, body: `${event.author} invited you · ${when} · ${nodeName}` };
}

/** Only ever asked of a poll in someone else's namespace (`watchedOf`), which is its host's. */
export function noticeOfPoll(poll: Poll, nodeName: string): Notice | null {
  if (poll.state !== 'open') return null;
  return { kind: 'polls', told: `poll/${poll.id}`, title: `New poll: ${poll.title}`, body: `${poll.host} asks when everyone can meet · ${nodeName}` };
}

export interface TellDeps {
  readonly ports: CalendarPorts;
  readonly engine: Pick<CalendarEngine, 'decodeEvent' | 'team'>;
  readonly me: string;
  readonly nodeName: (id: string) => string;
  readonly when: (event: Event) => string;
}

/** Reads the change and tells the member about it once, if it is theirs to be told. */
export async function tellAbout(change: StorageChange, d: TellDeps): Promise<void> {
  const watched: Watched | null = watchedOf(change, d.me);
  if (watched === null) return;
  const bytes: Uint8Array | null = await d.ports.storage.get(watched.store, watched.key);
  if (bytes === null) return;
  let notice: Notice | null;
  if (watched.what === 'poll') {
    notice = noticeOfPoll(d.engine.team.decodePoll(bytes), d.nodeName(watched.node));
  } else {
    const event: Event = d.engine.decodeEvent(bytes);
    notice = noticeOfEvent(event, d.me, d.when(event), d.nodeName(watched.node));
  }
  if (notice === null) return;
  const marker: string = `${TOLD_PREFIX}${notice.told}`;
  if ((await d.ports.storage.get({ kind: 'user' }, marker)) !== null) return;
  await d.ports.storage.set({ kind: 'user' }, marker, new Uint8Array([1]));
  await d.ports.notify(notice.kind, notice.title, notice.body);
}
