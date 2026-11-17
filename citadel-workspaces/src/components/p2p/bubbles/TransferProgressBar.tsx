import { formatBytes } from '@/lib/format-bytes';

/**
 * A file's progress: the bar a screen reader reads as a percentage, and the percent and bytes
 * under it. One drawing for every transfer, a peer's in its bubble and a channel's upload strip,
 * so the two cannot disagree on how far a file has got.
 */
export function TransferProgressBar({ percent, doneBytes, totalBytes, label, onPrimary }: {
  percent: number;
  doneBytes: number;
  totalBytes: number;
  /** The bar's accessible name ("Transfer of plan.pdf"). */
  label: string;
  /** Drawn on the sender's own bubble (bg-primary), which takes the bubble's foreground. */
  onPrimary: boolean;
}): JSX.Element {
  const shown: number = Math.round(percent);
  return (
    <div className="mb-2">
      <div
        role="progressbar"
        aria-valuenow={shown}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        aria-valuetext={`${shown} percent`}
        className={`h-1.5 rounded-full overflow-hidden ${onPrimary ? 'bg-primary-foreground/25' : 'bg-foreground/10'}`}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${onPrimary ? 'bg-primary-foreground' : 'bg-primary-accent'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex justify-between text-xs mt-1">
        <span>{shown}%</span>
        <span>{formatBytes(doneBytes)} / {formatBytes(totalBytes)}</span>
      </div>
    </div>
  );
}
