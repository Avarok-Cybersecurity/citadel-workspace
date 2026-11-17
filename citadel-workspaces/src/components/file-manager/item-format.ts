/**
 * The words an item's metadata is shown in.
 */
export { formatBytes as formatSize } from '@/lib/format-bytes';

function startOfDay(at: number): number {
  const d: Date = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `locale` is the reader's (undefined asks the browser); tests pass one. */
export function formatModified(at: number, now: number, locale: string | undefined): string {
  if (!Number.isFinite(at) || at <= 0) return '—';
  const today: number = startOfDay(now);
  const day: number = startOfDay(at);
  if (day === today) {
    return `Today, ${new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)}`;
  }
  if (day === startOfDay(today - 1)) return 'Yesterday';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(at);
}
