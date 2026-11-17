/**
 * The consumer has to be WIRED, not merely written.
 *
 * A module that recognises `MessageSendFailure` is worth nothing if the handler
 * the WebSocket feeds never calls it — which is precisely the state the UI was
 * in: the machinery for showing a failed message existed and this response was
 * simply never looked at.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventEmitter } from '../../event-emitter';
import { resetSendFailureThrottle } from '../send-failure';

const HANDLER: string = join(process.cwd(), 'src', 'lib', 'p2p', 'message-handler.ts');

describe('the WebSocket handler consumes send failures', () => {
  beforeEach(() => resetSendFailureThrottle());

  it('calls the reader and the reporter from handleWebSocketMessage', () => {
    const source: string = readFileSync(HANDLER, 'utf8');
    const entry: number = source.indexOf('handleWebSocketMessage');
    expect(entry, 'handleWebSocketMessage has moved or been renamed').toBeGreaterThan(-1);
    const body: string = source.slice(entry, entry + 1200);
    expect(body, 'the handler no longer consumes MessageSendFailure').toContain('consumeSendFailure');
  });

  it('the reported event carries what a surface needs to speak', async () => {
    const { reportSendFailure } = await import('../send-failure');
    const seen: Array<{ reason?: string }> = [];
    eventEmitter.on('p2p:send-failed', (e: unknown) => seen.push(e as { reason?: string }));
    reportSendFailure({ cid: 1n, message: 'Peer connection for 42 not found' });
    expect(seen[0]?.reason).toMatch(/not open/i);
  });
});
