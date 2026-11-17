/**
 * Cloudflare Turnstile, as `window.turnstile`, honouring Cloudflare's published
 * TEST site keys: the always-pass key issues a dummy token, the always-fail key
 * calls the error callback. Doubled because it is the I/O seam -- the real API
 * is a script from challenges.cloudflare.com and an iframe -- and no test may
 * solve, or even fetch, a real challenge.
 */
import type { TurnstileApi, TurnstileRenderOptions } from '@/lib/onboarding/turnstile';
import { FAKE_TOKEN_BINDING, FAKE_TOKEN_PREFIX } from '@/lib/sign-in/__tests__/fake-admission';

export const ALWAYS_PASS: '1x00000000000000000000AA' = '1x00000000000000000000AA';
export const ALWAYS_FAIL: '2x00000000000000000000AB' = '2x00000000000000000000AB';

export class FakeTurnstile implements TurnstileApi {
  readonly rendered: TurnstileRenderOptions[] = [];
  /** The element each widget was drawn into. */
  readonly containers: HTMLElement[] = [];
  readonly issued: string[] = [];
  resets: number = 0;
  private readonly widgets: Map<string, TurnstileRenderOptions> = new Map<string, TurnstileRenderOptions>();

  private issue(options: TurnstileRenderOptions): void {
    setTimeout((): void => {
      if (options.sitekey === ALWAYS_PASS) {
        const binding: string = options.cData === undefined ? '' : `${FAKE_TOKEN_BINDING}${options.cData}`;
        const token: string = `${FAKE_TOKEN_PREFIX}${this.issued.length + 1}${binding}`;
        this.issued.push(token);
        options.callback(token);
      } else {
        options['error-callback']();
      }
    }, 0);
  }

  render(container: HTMLElement, options: TurnstileRenderOptions): string {
    const id: string = `widget-${this.rendered.length + 1}`;
    this.rendered.push(options);
    this.containers.push(container);
    this.widgets.set(id, options);
    this.issue(options);
    return id;
  }

  reset(widgetId: string): void {
    this.resets += 1;
    const options: TurnstileRenderOptions | undefined = this.widgets.get(widgetId);
    if (options) this.issue(options);
  }

  remove(widgetId: string): void {
    this.widgets.delete(widgetId);
  }
}

export function installFakeTurnstile(): FakeTurnstile {
  const fake: FakeTurnstile = new FakeTurnstile();
  window.turnstile = fake;
  return fake;
}

/** A script tag for Cloudflare's API on the page: the check was loaded. */
export const turnstileScriptLoaded = (): boolean =>
  [...document.querySelectorAll('script')].some((s: HTMLScriptElement) => s.src.includes('challenges.cloudflare.com'));
