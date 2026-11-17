/**
 * Cloudflare Turnstile, loaded only when the verification step is on screen.
 *
 * Nobody else on the site needs it, so it is not in index.html: the script is
 * injected the first time `loadTurnstile` is called and the promise is kept, so
 * a second visit to the step reuses the loaded API rather than injecting again.
 * A load that FAILS is not kept -- the next call tries again -- because the
 * common failure is transient (offline, a blocked third-party request) and a
 * cached rejection would leave "Try again" doing nothing.
 *
 * Explicit rendering (`?render=explicit`), so the widget exists only while the
 * component that asked for it is mounted, and is removed with it.
 */

/** Public by design: it is sent to every visitor. Valid for work.avarok.net, localhost and 127.0.0.1. */
export const TURNSTILE_SITEKEY: string = '0x4AAAAAAFAR1uNZSc7lTBiy';

/** Must match what the control plane's siteverify expects for this form. */
export const TURNSTILE_ACTION: string = 'create-workspace';

export const TURNSTILE_SCRIPT_URL: string =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** How long to wait for the script before calling it a failure the visitor can retry. */
export const TURNSTILE_LOAD_TIMEOUT_MS: number = 15_000;

export interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  /** What the token is bound to, echoed by siteverify as `cdata` (a workspace's slug). */
  cData?: string;
  theme: 'light' | 'dark' | 'auto';
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | undefined;

export function loadTurnstile(
  doc: Document = document,
  win: Window = window,
  timeoutMs: number = TURNSTILE_LOAD_TIMEOUT_MS,
): Promise<TurnstileApi> {
  if (win.turnstile) return Promise.resolve(win.turnstile);
  if (loading) return loading;

  const attempt: Promise<TurnstileApi> = new Promise<TurnstileApi>((resolve, reject) => {
    const script: HTMLScriptElement = doc.createElement('script');
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => fail('timed out'), timeoutMs);

    function fail(why: string): void {
      clearTimeout(timer);
      script.remove();
      reject(new Error(`The human-verification check could not be loaded (${why}).`));
    }

    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      clearTimeout(timer);
      if (win.turnstile) resolve(win.turnstile);
      else fail('no API after load');
    });
    script.addEventListener('error', () => fail('blocked or offline'));
    doc.head.appendChild(script);
  });

  loading = attempt;
  attempt.catch(() => {
    if (loading === attempt) loading = undefined;
  });
  return attempt;
}
