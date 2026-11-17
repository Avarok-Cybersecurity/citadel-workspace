/** The zone an event was made in, beside its time, when it is not the zone the member reads in. */
interface ZoneBadgeProps {
  /** The abbreviation ("EST"); the full IANA name is the title. */
  label: string;
  zone: string;
}

export function ZoneBadge({ label, zone }: ZoneBadgeProps): JSX.Element {
  return (
    <span className="inline-flex shrink-0 items-center rounded-sm bg-muted px-1 text-xs font-medium leading-4 text-muted-foreground" title={zone} data-testid="calendar-zone-badge">
      {label}
    </span>
  );
}
