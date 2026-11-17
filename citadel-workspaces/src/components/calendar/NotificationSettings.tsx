/**
 * The member's Calendar notification settings (notify-prefs.ts), the one form shown both in the
 * Calendar and under Apps in the workspace's Settings: whether the Calendar notifies at all, which
 * kinds, the reminders a new event starts with, and whether a notice may also reach this device's
 * notification centre, with a preview of a reminder as it would arrive. Each change is saved as it
 * is made (use-notify-prefs.ts); nothing here reads a store.
 */
import { useId } from 'react';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { LEAD_CHOICES, leadLabel, NOTICE_KINDS, type NoticeDelivery, type NoticeKind, type NotifyPrefs } from '@/lib/calendar/notify-prefs';
import type { PrefsState } from './use-notify-prefs';

/** Whether this browser will show this site's system notifications: the browser's answer, or that it has none. */
export type SystemPermission = NotificationPermission | 'unsupported';

const KINDS: Readonly<Record<NoticeKind, { label: string; hint: string }>> = {
  reminders: { label: 'Reminders for my events', hint: 'Before an event you set a reminder on.' },
  invitations: { label: 'Invitations', hint: 'When someone adds you to an event.' },
  bookings: { label: 'Bookings', hint: 'When a booking with you is made, answered or cancelled.' },
  polls: { label: 'Polls', hint: 'When a poll is opened on a page you can see.' },
};

const DELIVERY: readonly { value: NoticeDelivery; label: string; hint: string }[] = [
  { value: 'system', label: 'In Citadel and on this device', hint: 'In the bell, and in your system notifications when Citadel is not in front.' },
  { value: 'in_app', label: 'In Citadel only', hint: 'In the bell, never in your system notifications.' },
];

const BOX: string = 'min-h-[44px] min-w-0 cursor-pointer rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground has-[:checked]:border-primary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring';
/** A lead time: its box and its words on one line. */
const OPTION: string = `flex items-center gap-3 ${BOX}`;
/** An option whose name and hint stack beside its box. */
const STACKED: string = `grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 ${BOX}`;
const LEGEND: string = 'mb-2 text-sm font-semibold text-foreground';
/** A native checkbox drawn as a switch, so the whole row is its 44px target (the Radix switch is a 24px button). */
const SWITCH: string = "relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-muted-foreground bg-input transition-colors checked:border-transparent checked:bg-primary focus-visible:outline-none before:absolute before:left-0 before:top-0 before:h-5 before:w-5 before:rounded-full before:bg-background before:shadow before:transition-transform before:content-[''] checked:before:translate-x-5";

function permissionNote(permission: SystemPermission): string | null {
  if (permission === 'denied') return 'Your browser blocks notifications from this site, so only the bell will show them until you allow them in its site settings.';
  if (permission === 'unsupported') return 'This browser shows no system notifications, so only the bell will show them.';
  if (permission === 'default') return 'Your browser will ask once before the first one is shown.';
  return null;
}

function Preview({ prefs }: { prefs: NotifyPrefs }): JSX.Element {
  const on: boolean = prefs.enabled && prefs.kinds.reminders;
  return (
    <section aria-labelledby="calendar-notify-preview" className="flex min-w-0 flex-col gap-2" data-testid="calendar-notify-preview">
      <h3 id="calendar-notify-preview" className="text-sm font-semibold text-foreground">Preview</h3>
      {on ? (
        <>
          <div className="flex min-w-0 gap-3 rounded-lg border border-border bg-surface px-3.5 py-3" aria-label="A reminder as it arrives">
            <MemberAvatar username="Calendar" name="Calendar" className="h-9 w-9" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-5 text-foreground">Design review</p>
                <span className="shrink-0 text-xs leading-5 text-muted-foreground">now</span>
              </div>
              <p className="mt-0.5 break-words text-sm leading-5 text-foreground/80">Starts at 2:00 PM · Engineering</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {prefs.delivery === 'system' ? 'Shown in the bell, and on this device when Citadel is not in front.' : 'Shown in the bell only.'}
          </p>
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3.5 py-3 text-sm text-muted-foreground">You will not be reminded of your events.</p>
      )}
    </section>
  );
}

export function NotificationSettings({ state, permission }: { state: Extract<PrefsState, { kind: 'ready' }>; permission: SystemPermission }): JSX.Element {
  const base: string = useId();
  const { prefs, save } = state;
  const off: boolean = !prefs.enabled;
  const note: string | null = prefs.delivery === 'system' ? permissionNote(permission) : null;
  const lead: number[] = [...new Set([...LEAD_CHOICES, ...prefs.leadMinutes])].sort((a: number, b: number) => a - b);
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="calendar-notify-settings">
      <label className="flex min-h-[44px] min-w-0 cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-background px-3 py-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">Calendar notifications</span>
          <span id={`${base}-on-hint`} className="block text-sm text-muted-foreground">{state.chosen ? 'For your account, in every workspace window.' : 'Not set yet: everything below is on until you change it.'}</span>
        </span>
        <input type="checkbox" role="switch" aria-label="Calendar notifications" aria-describedby={`${base}-on-hint`} className={SWITCH} checked={prefs.enabled}
          onChange={(e): void => save({ ...prefs, enabled: e.target.checked })} />
      </label>
      <fieldset className="flex min-w-0 flex-col gap-2" disabled={off}>
        <legend className={LEGEND}>Notify me about</legend>
        {NOTICE_KINDS.map((kind: NoticeKind) => (
          <label key={kind} className={STACKED}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={prefs.kinds[kind]}
              onChange={(e): void => save({ ...prefs, kinds: { ...prefs.kinds, [kind]: e.target.checked } })} />
            <span className="min-w-0 font-medium">{KINDS[kind].label}</span>
            <span className="col-start-2 min-w-0 text-muted-foreground">{KINDS[kind].hint}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-2" disabled={off} aria-describedby={`${base}-lead-hint`}>
        <legend className={LEGEND}>Reminders on new events</legend>
        <div className="flex min-w-0 flex-wrap gap-2">
          {lead.map((m: number) => (
            <label key={m} className={OPTION}>
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={prefs.leadMinutes.includes(m)}
                onChange={(e): void => save({ ...prefs, leadMinutes: e.target.checked ? [...prefs.leadMinutes, m] : prefs.leadMinutes.filter((c: number) => c !== m) })} />
              {leadLabel(m)}
            </label>
          ))}
        </div>
        <p id={`${base}-lead-hint`} className="text-sm text-muted-foreground">A new event starts with these; you can change them on each event.</p>
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-2" disabled={off}>
        <legend className={LEGEND}>Where they appear</legend>
        {DELIVERY.map((d) => (
          <label key={d.value} className={STACKED}>
            <input type="radio" name={`${base}-delivery`} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={prefs.delivery === d.value}
              onChange={(): void => save({ ...prefs, delivery: d.value })} />
            <span className="min-w-0 font-medium">{d.label}</span>
            <span className="col-start-2 min-w-0 text-muted-foreground">{d.hint}</span>
          </label>
        ))}
        {note !== null && <p className="text-sm text-muted-foreground" data-testid="calendar-notify-permission">{note}</p>}
      </fieldset>
      <Preview prefs={prefs} />
      <div className="flex min-w-0 flex-col gap-1">
        <p role="status" className="text-sm text-muted-foreground">{state.saving ? 'Saving…' : ''}</p>
        {state.error !== null && <p role="alert" className="text-sm text-destructive-emphasis">{state.error}</p>}
        <p className="text-sm text-muted-foreground">Notices arrive while one of your workspace windows is open. A reminder that falls due while none is open is listed once when you return; invitations and polls made meanwhile are in the Calendar, without a notice.</p>
      </div>
    </div>
  );
}
