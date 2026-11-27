/**
 * Sending: a 201 with an id is sent; every refusal reads as a sentence the person can act on, and
 * nothing is sent with credentials. Context: the browser is reduced to brand, major and OS.
 */
import { describe, expect, it } from 'vitest';
import { BUG_REPORTS_PATH, sendReport, REFUSAL_SENTENCE, type SendOutcome } from '../send';
import { REPORT_FORMAT, type BugReport, type ContextItem } from '../report-model';
import { contextItems, reducedBrowser } from '../context';

const report: BugReport = { format: REPORT_FORMAT, surface: 's', note: '', contact: null, context: [], console: [], crumbs: [], trail: [] };

function post(status: number, body: unknown, seen: RequestInit[]): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    expect(url).toBe(BUG_REPORTS_PATH);
    seen.push(init ?? {});
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe('sendReport', () => {
  it('201 with an id: sent, without credentials', async () => {
    const seen: RequestInit[] = [];
    expect(await sendReport(post(201, { id: 'br_1' }, seen), report)).toEqual({ kind: 'sent', id: 'br_1' });
    expect(seen[0]?.credentials).toBe('omit');
  });
  it('a refusal the server names is said in its own sentence; an unknown one in the general one', async () => {
    expect(await sendReport(post(422, {}, []), report)).toEqual({ kind: 'refused', sentence: REFUSAL_SENTENCE[422] });
    const other: SendOutcome = await sendReport(post(500, {}, []), report);
    expect(other.kind).toBe('refused');
  });
  it('201 without an id is not a sent report', async () => {
    expect((await sendReport(post(201, {}, []), report)).kind).toBe('refused');
  });
  it('a network failure is a refusal, not a throw', async () => {
    const failing: typeof fetch = (async (): Promise<Response> => { throw new TypeError('offline'); }) as typeof fetch;
    expect((await sendReport(failing, report)).kind).toBe('refused');
  });
});

describe('context', () => {
  it('reduces the browser', () => {
    expect(reducedBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36')).toBe('Chrome 131 on macOS');
    expect(reducedBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe('Safari 18 on iOS');
  });
  it('the build and the tenant are always said and cannot be removed', () => {
    const items: ContextItem[] = contextItems({ build: 'seq 9', agentVersion: null, agentOs: null, userAgent: '', viewportWidth: 390, theme: 'dark', pathname: '/workspace/abc', tenantHost: 'acme.avarok.net', online: true });
    expect(items.filter((i) => !i.removable).map((i) => [i.key, i.value])).toEqual([['build', 'seq 9'], ['tenant', 'acme.avarok.net']]);
    expect(items.find((i) => i.key === 'route')?.value).toBe('/workspace/:id');
  });
});
