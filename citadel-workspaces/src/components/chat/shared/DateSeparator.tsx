/**
 * The rule between one day's messages and the next.
 *
 * Shared because the two chat surfaces had drifted: group chat showed date
 * separators and P2P chat showed none, so a long DM was an undifferentiated
 * run of messages with no way to tell yesterday from last month. Anyone using
 * both in one session saw two different products.
 *
 * `aria-hidden` on the rules, and the date itself as a real heading for the
 * run that follows: a screen reader should hear "Tuesday", not two decorative
 * lines around it.
 */
export function DateSeparator({ date }: { date: string }): JSX.Element {
  return (
    <div className="my-4 flex items-center justify-center">
      <div className="h-px flex-1 bg-border" aria-hidden="true" />
      <span className="px-3 text-xs text-muted-foreground" role="separator" aria-label={date}>
        {date}
      </span>
      <div className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}
