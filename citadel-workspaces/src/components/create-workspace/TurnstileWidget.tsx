import { useEffect, useRef, useState, type JSX } from 'react';
import { useTheme } from 'next-themes';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loadTurnstile, type TurnstileApi } from '@/lib/onboarding/turnstile';

export interface TurnstileWidgetProps {
  /** Whose check this is: the hosted create-workspace key, or a workspace's own for sign-in. */
  readonly sitekey: string;
  /** Must match what the verifying server expects for this form. */
  readonly action: string;
  /** The workspace the token is for (its slug, Turnstile `cData`), or null for one not bound to any. */
  readonly cData: string | null;
  /** Receives a fresh token, or `undefined` when the last one expired or failed. */
  readonly onToken: (token: string | undefined) => void;
  /** Change it to discard the current token and ask again -- after a refused request. */
  readonly resetSignal: number;
}

type LoadState = { readonly kind: 'loading' } | { readonly kind: 'ready' } | { readonly kind: 'failed'; readonly message: string };

/**
 * The Cloudflare Turnstile challenge, rendered explicitly into this component.
 *
 * Mount loads the script (once per page) and renders; unmount removes the
 * widget, so leaving the step leaves nothing of Cloudflare's running. A token is
 * single-use at siteverify, so the parent resets the widget after any refused
 * request instead of re-sending a token the server has already spent.
 */
export function TurnstileWidget({ sitekey, action, cData, onToken, resetSignal }: TurnstileWidgetProps): JSX.Element {
  const container: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const api: React.MutableRefObject<{ turnstile: TurnstileApi; widgetId: string } | undefined> = useRef(undefined);
  const tokenSink: React.MutableRefObject<(token: string | undefined) => void> = useRef(onToken);
  tokenSink.current = onToken;
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState<number>(0);
  const { resolvedTheme } = useTheme();
  const theme: 'light' | 'dark' = resolvedTheme === 'light' ? 'light' : 'dark';

  useEffect(() => {
    let cancelled: boolean = false;
    setLoad({ kind: 'loading' });
    loadTurnstile().then(
      (turnstile: TurnstileApi) => {
        if (cancelled || !container.current) return;
        const widgetId: string = turnstile.render(container.current, {
          sitekey,
          action,
          ...(cData === null ? {} : { cData }),
          theme,
          callback: (token: string) => tokenSink.current(token),
          'expired-callback': () => tokenSink.current(undefined),
          'error-callback': () => tokenSink.current(undefined),
        });
        api.current = { turnstile, widgetId };
        setLoad({ kind: 'ready' });
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoad({ kind: 'failed', message: error instanceof Error ? error.message : 'Verification could not load.' });
      },
    );
    return (): void => {
      cancelled = true;
      const mounted: { turnstile: TurnstileApi; widgetId: string } | undefined = api.current;
      api.current = undefined;
      if (mounted) mounted.turnstile.remove(mounted.widgetId);
      tokenSink.current(undefined);
    };
  }, [attempt, theme, sitekey, action, cData]);

  useEffect(() => {
    if (resetSignal === 0) return;
    const mounted: { turnstile: TurnstileApi; widgetId: string } | undefined = api.current;
    tokenSink.current(undefined);
    if (mounted) mounted.turnstile.reset(mounted.widgetId);
  }, [resetSignal]);

  return (
    <div className="space-y-2" data-testid="turnstile">
      {/* Turnstile draws a fixed-width iframe in here; centred, not hugging the card's left edge. */}
      <div ref={container} className="flex justify-center" />
      {load.kind === 'loading' && (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading the verification check…
        </p>
      )}
      {load.kind === 'failed' && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-emphasis">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{load.message}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
