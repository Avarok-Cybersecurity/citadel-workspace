/**
 * Console capture with every rule real: the buffer, the formatting, the console hook and the
 * consent and capability decisions. Replaced: the clock and the console (fakes.ts), the consent
 * feed (a listener the test calls, as the response handler would), and the agent link
 * (`send` records the request; the agent's own handling is tested in the agent).
 */
import { describe, expect, it } from 'vitest';
import type { InternalServiceRequest, MyConsent } from 'citadel-workspace-client-ts';
import { startConsoleCapture, type CaptureDeps } from '../capture';
import type { ConsoleTarget } from '../hook';
import { ManualClock, recordingConsole } from './fakes';

const consent = (uploads_allowed: boolean): MyConsent => ({
  accepted_platform_version: 2, accepted_workspace_version: null, required_platform_version: 2,
  required_workspace_version: null, terms_current: true, telemetry_enabled: uploads_allowed, uploads_allowed,
});

const flushed = (): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

type RecordingConsole = ReturnType<typeof recordingConsole>;
type ConsoleRequest = Extract<InternalServiceRequest, { BrowserConsole: unknown }>;

interface Harness {
  clock: ManualClock;
  console: RecordingConsole;
  original: ConsoleTarget;
  sent: InternalServiceRequest[];
  say: (c: MyConsent) => Promise<void>;
  after: (ms: number) => Promise<void>;
  stop: () => void;
  following: () => boolean;
}

function setup(options: { takes?: boolean | Error; send?: (request: InternalServiceRequest) => Promise<void> } = {}): Harness {
  const clock: ManualClock = new ManualClock();
  const console: RecordingConsole = recordingConsole();
  const original: ConsoleTarget = { error: console.error, warn: console.warn };
  const sent: InternalServiceRequest[] = [];
  let listener: ((c: MyConsent) => void) | null = null;
  const takes: boolean | Error = options.takes ?? true;
  const deps: CaptureDeps = {
    clock, console,
    onConsent: (l) => { listener = l; return (): void => { listener = null; }; },
    agentTakesConsole: () => (takes instanceof Error ? Promise.reject(takes) : Promise.resolve(takes)),
    ownCid: () => Promise.resolve(77n),
    send: options.send ?? ((request: InternalServiceRequest): Promise<void> => { sent.push(request); return Promise.resolve(); }),
    newRequestId: () => 'id-1',
  };
  const stop: () => void = startConsoleCapture(deps);
  const say = async (c: MyConsent): Promise<void> => { listener?.(c); await flushed(); };
  const after = async (ms: number): Promise<void> => { clock.advance(ms); await flushed(); };
  return { clock, console, original, sent, say, after, stop, following: (): boolean => listener !== null };
}

describe('console capture', () => {
  it('leaves the console alone and sends nothing until consent allows uploads', async () => {
    const t: Harness = setup();
    t.console.error('boom before consent');
    await t.after(60_000);
    await t.say(consent(false));
    t.console.error('boom after a refusal');
    await t.after(60_000);
    expect(t.console.error).toBe(t.original.error);
    expect(t.sent).toEqual([]);
    expect(t.console.printed).toHaveLength(2);
  });

  it('sends what the console said once uploads are allowed, for this tab\'s session', async () => {
    const t: Harness = setup();
    await t.say(consent(true));
    t.console.warn('slow down');
    t.console.error(new TypeError('x is undefined'));
    expect(t.console.printed).toHaveLength(2);
    await t.after(5_000);
    expect(t.sent).toHaveLength(1);
    const request: ConsoleRequest = t.sent[0] as ConsoleRequest;
    expect(request.BrowserConsole.cid).toBe(77n);
    expect(request.BrowserConsole.entries.map((e) => [e.source, e.message])).toEqual([
      ['ConsoleWarn', 'slow down'], ['ConsoleError', 'TypeError: x is undefined'],
    ]);
  });

  it('restores the console and discards what it held when consent is withdrawn', async () => {
    const t: Harness = setup();
    await t.say(consent(true));
    t.console.error('held, then withdrawn');
    await t.say(consent(false));
    expect(t.console.error).toBe(t.original.error);
    await t.after(60_000);
    expect(t.sent).toEqual([]);
  });

  it('never engages for an agent that does not take console lines, or cannot say', async () => {
    for (const takes of [false, new Error('no answer')]) {
      const t: Harness = setup({ takes });
      await t.say(consent(true));
      t.console.error('boom');
      await t.after(60_000);
      expect(t.console.error).toBe(t.original.error);
      expect(t.sent).toEqual([]);
    }
  });

  it('keeps an extension\'s errors on the page', async () => {
    const t: Harness = setup();
    await t.say(consent(true));
    t.console.error({ message: 'Uncaught TypeError', stack: 'at n (chrome-extension://abc/src/js/Grammarly.js:2:1)' });
    await t.after(60_000);
    expect(t.sent).toEqual([]);
  });

  it('stops for good when a send fails, without logging about it', async () => {
    const t: Harness = setup({ send: () => Promise.reject(new Error('unknown variant BrowserConsole')) });
    await t.say(consent(true));
    t.console.error('first');
    await t.after(5_000);
    expect(t.console.error).toBe(t.original.error);
    expect(t.following()).toBe(false);
    expect(t.console.printed.map(([, args]) => args[0])).toEqual(['first']);
  });

  it('does not capture what is logged while a line is being sent', async () => {
    const requests: InternalServiceRequest[] = [];
    const t: Harness = setup({ send: (request) => { requests.push(request); t.console.error('logged by the send path'); return Promise.resolve(); } });
    await t.say(consent(true));
    t.console.error('first');
    await t.after(5_000);
    await t.after(60_000);
    expect(t.console.printed).toHaveLength(2);
    expect(requests).toHaveLength(1);
  });
});
