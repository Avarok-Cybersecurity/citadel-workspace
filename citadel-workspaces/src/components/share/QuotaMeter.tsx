/** How many secure links are in use: yours, and the workspace's shared pool when it has one. With no limit there is nothing to fill, so no bar. */
import { quotaFraction, quotaText, type LinkQuota } from '@/lib/share/link-lifetime';

export function QuotaMeter({ quota, testId }: { quota: LinkQuota; testId: string }): JSX.Element {
  const fraction: number | null = quotaFraction(quota);
  const text: string = quotaText(quota);
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Secure links in use</span>
        <span className="text-foreground" data-testid={`${testId}-text`}>{text}</span>
      </div>
      {fraction !== null && <UsedBar used={Math.round(fraction * 100)} text={text} />}
    </div>
  );
}

function UsedBar({ used, text }: { used: number; text: string }): JSX.Element {
  return (
    <div role="meter" aria-label="Secure links in use" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} aria-valuetext={text}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
      <div className={used >= 100 ? 'h-full bg-destructive' : 'h-full bg-primary-accent'} style={{ width: `${used}%` }} />
    </div>
  );
}
