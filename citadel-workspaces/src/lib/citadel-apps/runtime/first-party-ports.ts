/**
 * The ports only a first-party glue app is bound to, beside nodes-port.ts: `members.list` from the
 * roster this page already holds, and `notifications` as an entry in the page's notification list
 * badged with the app's name, so a reminder can never pass for the workspace's own message.
 *
 * Both are pure over what they are handed (SBIO): the roster read and the notification sink are
 * the page's, injected by the mount.
 */
import type { Member } from '../sdk/generated/Member';
import type { MembersPort, NotifyPort } from '../host/ports';

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

/** One notification as the page's list shows it: who it is from, its title and its text. */
export interface AppNotice {
  readonly from: string;
  readonly appId: string;
  readonly title: string;
  readonly body: string;
}

export type NoticeSink = (notice: AppNotice) => void;

export function badgedNotifyPort(app: { readonly id: string; readonly name: string }, sink: NoticeSink): NotifyPort {
  return {
    Notify: ({ title, body }): ReturnType<NotifyPort['Notify']> => {
      sink({ from: app.name, appId: app.id, title, body });
      return { ok: null };
    },
  };
}
