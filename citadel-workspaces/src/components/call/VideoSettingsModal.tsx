import { Check, Gauge } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { VideoQuality } from '@/lib/call/video-quality';
import { VIDEO_QUALITY_OPTIONS } from '@/lib/call/video-quality-options';

interface VideoSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quality: VideoQuality;
  onQualityChange: (quality: VideoQuality) => void;
}

/**
 * Video quality, chosen by the person paying for the bandwidth.
 *
 * A radiogroup rather than a select: there are four options with a sentence of
 * explanation each, and the explanation is the part that makes the choice
 * possible — hiding it behind a closed dropdown would leave somebody picking
 * between four words they have no way to compare.
 *
 * Applies immediately, with no Save. There is nothing to lose by trying one,
 * the effect is visible in the call within a second, and a modal that makes
 * somebody commit before they can see what they chose is a modal that gets
 * cancelled.
 */
export function VideoSettingsModal({
  open,
  onOpenChange,
  quality,
  onQualityChange,
}: VideoSettingsModalProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="video-settings-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary-accent" aria-hidden="true" />
            Video quality
          </DialogTitle>
          <DialogDescription>
            Applies to your camera and anything you share. Takes effect straight away.
          </DialogDescription>
        </DialogHeader>

        <div
          role="radiogroup"
          aria-label="Video quality"
          className="mt-2 space-y-2"
          data-testid="video-quality-options"
        >
          {VIDEO_QUALITY_OPTIONS.map((option) => {
            const selected: boolean = option.id === quality;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`video-quality-${option.id}`}
                onClick={() => onQualityChange(option.id)}
                className={cn(
                  'tap-target flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'border-primary-accent bg-primary-accent/10'
                    : 'border-border bg-card hover:border-primary-accent/50 hover:bg-surface',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2',
                    // bg-primary, not bg-primary-accent, because the tick
                    // inside is text-primary-foreground -- and --primary-
                    // foreground is defined as the foreground for --primary.
                    // On --primary-accent the pairing is only accidentally
                    // right: that token is DARK in light mode but LIGHT in dark
                    // mode, where a white tick on it measured 2.86:1, under the
                    // 3:1 WCAG asks of a non-text indicator. On --primary it is
                    // 7.70:1 light and 5.74:1 dark.
                    selected ? 'border-primary bg-primary' : 'border-border',
                  )}
                  aria-hidden="true"
                >
                  {selected && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium text-foreground">{option.label}</span>
                    {/* The cost, next to the name: the choice is about
                        bandwidth, so the number belongs where the decision is
                        made rather than in a tooltip. */}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {option.approxBitrate}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{option.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
