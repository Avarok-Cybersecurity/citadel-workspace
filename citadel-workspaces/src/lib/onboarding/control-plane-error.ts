/**
 * A request the control plane refused, or could not be asked.
 *
 * `status` is the HTTP status, or 0 when no response arrived at all (offline,
 * DNS, CSP). 503 is the control plane saying it is not configured yet, which is
 * a state of the deployment rather than of the request, so it gets its own flag
 * and its own wording. `code` is the control plane's machine-readable reason
 * (`not-owner`, `no-subscription`, ...), or undefined when it gave none.
 */
export class ControlPlaneError extends Error {
  readonly status: number;
  readonly notConfigured: boolean;
  readonly code: string | undefined;

  constructor(status: number, message: string, code: string | undefined) {
    super(message);
    this.name = 'ControlPlaneError';
    this.status = status;
    this.code = code;
    this.notConfigured = status === 503;
  }

  /** Worth asking again: nothing answered, or the server failed rather than refused. */
  get transient(): boolean {
    return this.status === 0 || (this.status >= 500 && !this.notConfigured);
  }
}
