/**
 * The workspace server's admission check, for the fake agent: a workspace that
 * requires a human check refuses a Connect or Register without a valid token,
 * and a token works once (Turnstile's siteverify rejects a spent one).
 *
 * "Valid" is what the fake widget issues for Cloudflare's always-pass TEST
 * site key; nothing here talks to Cloudflare. A token names the workspace it
 * was rendered for (Turnstile `cData`) after FAKE_TOKEN_BINDING, and with
 * `workspace` set, one bound to another workspace or to none is refused, as the
 * tenant worker's boundVerdict refuses it.
 */
export const FAKE_TOKEN_PREFIX: 'XXXX.DUMMY.TOKEN.' = 'XXXX.DUMMY.TOKEN.';
export const FAKE_TOKEN_BINDING: '@' = '@';

const boundTo = (token: string): string | null => {
  const at: number = token.lastIndexOf(FAKE_TOKEN_BINDING);
  return at < 0 ? null : token.slice(at + 1);
};

export class FakeAdmission {
  required: boolean = false;
  /** The slug a token must be bound to; null accepts any binding (a server that does not check). */
  workspace: string | null = null;
  readonly spent: Set<string> = new Set<string>();
  /**
   * What an `admission_required` refusal publishes as `admission_challenge` (a self-hosted
   * server's check); undefined publishes nothing, as an older agent or a hosted server does.
   * `unknown`, so a test can publish a malformed one.
   */
  challenge: unknown = undefined;

  /** The refusal's extra fields for `reason`. */
  published(reason: string): Record<string, unknown> {
    return reason === 'admission_required' && this.challenge !== undefined ? { admission_challenge: this.challenge } : {};
  }

  /** The refusal's reason_code, or null to let the request through. */
  check(token: unknown): 'admission_required' | 'admission_failed' | null {
    if (!this.required) return null;
    if (token === null || token === undefined) return 'admission_required';
    if (typeof token !== 'string' || !token.startsWith(FAKE_TOKEN_PREFIX) || this.spent.has(token)) return 'admission_failed';
    if (this.workspace !== null && boundTo(token) !== this.workspace) return 'admission_failed';
    this.spent.add(token);
    return null;
  }
}
