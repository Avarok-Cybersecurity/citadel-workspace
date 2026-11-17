/**
 * What an app's pane shows while the app loads: the shape of what is coming -- a sheet of the
 * document's paper with lines of text on it -- and, over it, LoadProgress saying how far loading
 * has got. Never an empty pane: it fills the editor region the app will draw into, so nothing
 * jumps when the first page arrives. Reusable by every Citadel App; each says its own stage.
 */
import { Skeleton } from '@/components/ui/skeleton';
import type { LoadStage } from '@/lib/app-loading/load-stage';
import { LoadProgress } from './LoadProgress';

/**
 * Line widths of the sheet's placeholder text, as a paragraph's ragged right edge looks. Widths
 * the app already uses, so the shell's stylesheet (on the landing path) gains no rule for them.
 */
const PARAGRAPHS: readonly (readonly string[])[] = [
  ['w-1/2'],
  ['w-full', 'w-full', 'w-5/6', 'w-3/4'],
  ['w-full', 'w-5/6', 'w-full', 'w-1/2'],
  ['w-full', 'w-full', 'w-3/4'],
];

interface AppLoadingPaneProps {
  appName: string;
  stage: LoadStage;
}

export function AppLoadingPane({ appName, stage }: AppLoadingPaneProps): JSX.Element {
  return (
    <div className="relative flex min-h-0 flex-1 items-start justify-center overflow-hidden bg-muted/40 pt-8" data-testid="app-loading-pane">
      <div aria-hidden="true" className="app-loading-sheet flex flex-col gap-6 rounded-sm bg-card shadow-sm" data-testid="app-loading-sheet">
        {PARAGRAPHS.map((lines: readonly string[], p: number): JSX.Element => (
          <div key={p} className="grid gap-2">
            {lines.map((width: string, l: number): JSX.Element => <Skeleton key={l} className={`h-3 ${width}`} />)}
          </div>
        ))}
      </div>
      <div className="app-loading-card app-loading-floating absolute rounded-md border border-border bg-card p-4 shadow-md" data-testid="app-loading-card">
        <LoadProgress appName={appName} stage={stage} />
      </div>
    </div>
  );
}
