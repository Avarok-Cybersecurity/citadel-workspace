/**
 * The loading indicator every app's pane uses: what is happening in words, a bar, and the measured
 * detail. The bar is determinate when the stage has an honest fraction (a download of known size)
 * and indeterminate otherwise; ARIA has no valuenow for the latter, so none is given.
 *
 * Only the sentence is a live region: it changes once per stage, so a screen reader hears
 * "Downloading the Citadel Docs engine" once, not every byte. The bytes are the progressbar's
 * valuetext, read when someone asks.
 */
import { loadingView, type LoadStage, type LoadingView } from '@/lib/app-loading/load-stage';
import { AppLoadingStyles } from './AppLoadingStyles';

interface LoadProgressProps {
  /** The app's name as people know it: "Citadel Docs". */
  appName: string;
  stage: LoadStage;
}

export function LoadProgress({ appName, stage }: LoadProgressProps): JSX.Element {
  const view: LoadingView = loadingView(appName, stage);
  const percent: number | null = view.fraction === null ? null : Math.round(view.fraction * 100);
  return (
    <div className="grid gap-2" data-testid="app-loading-progress" data-stage={stage.kind}>
      <AppLoadingStyles />
      <p role="status" aria-live="polite" className="text-sm font-medium text-foreground">{view.label}</p>
      <div
        role="progressbar"
        aria-label={view.label}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : 100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={view.detail ?? undefined}
        className="app-loading-track"
        data-testid="app-loading-bar"
      >
        <div
          className="app-loading-fill"
          data-indeterminate={percent === null ? '' : undefined}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {/* Always rendered, so the card does not change height when a measured stage starts. */}
      <p aria-hidden="true" className="app-loading-detail text-xs text-muted-foreground tabular-nums" data-testid="app-loading-detail">{view.detail ?? ''}</p>
    </div>
  );
}
