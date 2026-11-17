import { Download } from 'lucide-react';
import { useInstallAction } from './use-install-action';

/**
 * In-app install affordance.
 *
 * Chrome puts an install icon in the omnibox once the app qualifies, but that is
 * easy to miss and not present on every platform, so the app offers it too.
 * Renders nothing at all when installing is impossible or pointless — the
 * browser has not offered a prompt, or we are already running installed — rather
 * than showing a button that does nothing.
 */
export function InstallAppButton({ className }: { className?: string }): JSX.Element | null {
  const { canInstall, needsManualInstall, installNow } = useInstallAction();

  const style: string =
    className ??
    'inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

  // iOS Safari never fires `beforeinstallprompt` — there is no programmatic
  // install on that platform — so `canInstall` is permanently false there and
  // this rendered nothing at all. That silently zeroed the install funnel for
  // every iPhone and iPad, on a product whose primary mobile surface is the
  // installed PWA. The manifest and apple-touch-icon groundwork was all in
  // place; only the affordance was missing.
  //
  // Not a button, because there is nothing to click: it is the instruction
  // Safari requires the user to follow.
  if (needsManualInstall) {
    return (
      <p className={`${style} cursor-default`}>
        <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          To install: tap <span className="font-semibold">Share</span>, then{' '}
          <span className="font-semibold">Add to Home Screen</span>
        </span>
      </p>
    );
  }

  if (!canInstall) return null;

  return (
    <button
      type="button"
      onClick={installNow}
      title="Install Citadel as an app"
      className={style}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      Install app
    </button>
  );
}
