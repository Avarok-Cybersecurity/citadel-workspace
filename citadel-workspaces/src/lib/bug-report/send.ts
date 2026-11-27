/**
 * Sending a report to Avarok over the control plane (`POST /api/bug-reports`, deploy/tenant-worker/
 * control/bug-reports.mjs). The fetch is injected (SBIO). A refusal is said in the words the
 * person reads; a report that could not be sent is never queued to go later without them.
 */
import type { BugReport } from './report-model';

export type SendOutcome =
  | { readonly kind: 'sent'; readonly id: string }
  | { readonly kind: 'refused'; readonly sentence: string };

export const BUG_REPORTS_PATH: string = '/api/bug-reports';

/** What each refusal the control plane answers means to the person sending. */
export const REFUSAL_SENTENCE: Readonly<Record<number, string>> = {
  413: 'The report is too large to send. Remove some console lines and try again.',
  422: 'The report still contained something that looked like a key or an address, so it was not sent. Remove the highlighted lines and try again.',
  429: 'You have sent several reports recently. Copy or download this one, or try again in an hour.',
  503: 'Reports are paused right now. Copy or download this one instead.',
};

const ELSEWHERE: string = 'The report could not be sent from here. Copy or download it instead.';

export async function sendReport(post: typeof fetch, report: BugReport): Promise<SendOutcome> {
  let response: Response;
  try {
    response = await post(BUG_REPORTS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      credentials: 'omit',
    });
  } catch {
    return { kind: 'refused', sentence: ELSEWHERE };
  }
  if (response.status === 201) {
    const body: unknown = await response.json().catch((): null => null);
    const id: unknown = typeof body === 'object' && body !== null ? (body as { id?: unknown }).id : undefined;
    if (typeof id === 'string' && id !== '') return { kind: 'sent', id };
    return { kind: 'refused', sentence: ELSEWHERE };
  }
  return { kind: 'refused', sentence: REFUSAL_SENTENCE[response.status] ?? ELSEWHERE };
}
