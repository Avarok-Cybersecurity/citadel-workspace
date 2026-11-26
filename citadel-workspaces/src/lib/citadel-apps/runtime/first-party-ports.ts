/**
 * The ports only a first-party glue app is bound to, beside nodes-port.ts: `members.list` from the
 * roster this page already holds; and `notifications`, which every instance granted it is given
 * (host-ports.ts), as an entry in the page's notification list badged with the app's name, so a
 * reminder can never pass for the workspace's own message, and opening the node the instance is
 * mounted on: the host names the node, never the app.
 *
 * Both are pure over what they are handed (SBIO): the roster read and the notification sink are
 * the page's, injected by the mount.
 */
import type { Member } from '../sdk/generated/Member';
import type { MembersPort, NotifyPort } from '../host/ports';
import type { NotifyAbout } from '../sdk/generated/NotifyAbout';
import type { NotifyKind } from '../sdk/generated/NotifyKind';

/** One roster entry as the page holds it. `isOnline` null means nobody has said. */
export interface RosterMember {
  readonly username: string;
  readonly displayName: string;
  readonly isOnline: boolean | null;
}

export type RosterRead = () => readonly RosterMember[];

/** The roster in username order, so two reads of the same roster answer the same list. */
export function rosterMembersPort(read: RosterRead): MembersPort {
  return {
    MembersList: (): ReturnType<MembersPort['MembersList']> => {
      const members: Member[] = read()
        // Unknown presence is reported as not online: the app is told only what the page knows.
        .map((m: RosterMember): Member => ({ username: m.username, display_name: m.displayName, online: m.isOnline === true }))
        .sort((a: Member, b: Member) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0));
      return { ok: { members } };
    },
  };
}

/** Where an instance's notifications come from: the app by id and name, and the node it is mounted on. */
export interface NoticeOrigin {
  readonly id: string;
  readonly name: string;
  readonly nodeId: string;
}

/**
 * One notification as the page's list shows it: who it is from, its title and its text, the node
 * it opens, and its sender line, all it says while the member keeps previews off. A notice with no
 * `kind` is the app's own to its member (a reminder): it has no sender line and its title shows.
 */
export interface AppNoticeEntry {
  readonly from: string;
  readonly appId: string;
  readonly nodeId: string;
  readonly title: string;
  readonly body: string;
  readonly senderLine: string | null;
}

const NOUNS: Readonly<Record<NotifyKind, string>> = { invitation: 'invitation', booking: 'booking', poll: 'poll', other: 'notice' };

/** The app, what the notice is about, and who it is from when the server said so (told-authors.ts). */
export function senderLine(app: string, kind: NotifyKind, from: string | null): string {
  return `${app}: new ${NOUNS[kind]}${from === null ? '' : ` from ${from}`}`;
}

/** The author of `about` when it is a change the server told this install of; otherwise no one. */
export type AuthorOf = (about: NotifyAbout) => string | null;

export type NoticeSink = (notice: AppNoticeEntry) => void;

export function badgedNotifyPort(origin: NoticeOrigin, sink: NoticeSink, authorOf: AuthorOf): NotifyPort {
  return {
    Notify: ({ title, body, kind, about }): ReturnType<NotifyPort['Notify']> => {
      const from: string | null = about === undefined || about === null ? null : authorOf(about);
      const line: string | null = kind === undefined || kind === null ? null : senderLine(origin.name, kind, from);
      sink({ from: origin.name, appId: origin.id, nodeId: origin.nodeId, title, body, senderLine: line });
      return { ok: null };
    },
  };
}
