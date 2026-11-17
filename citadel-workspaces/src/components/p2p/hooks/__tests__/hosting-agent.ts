/**
 * The stand-ins the read tests share: a fake agent that hosts the account and
 * answers ConversationMarkRead, and `document.hasFocus`, the browser fact the
 * read gate depends on. Everything else those tests run is production code.
 */
import { vi } from 'vitest';
import { act } from '@testing-library/react';
import type { InternalServiceRequest, InternalServiceResponse } from 'citadel-workspace-client-ts';
import { P2PMessengerManager } from '@/lib/p2p';
import { registerConversationSender } from '@/lib/agent-conversations/requests';
import { registerCapabilityRoute, forgetCapabilities, declareOnLeaderSocket, watchGreeting, type DeclaringClient, type Greeting } from '@/lib/agent-conversations/capabilities';
import { eventEmitter } from '@/lib/event-emitter';
import { instanceManager } from '@/lib/multi-instance';

export const PEER: bigint = 77n;
export const OWN: bigint = 5n;

export interface HostingAgent {
  /** Whether the window has the keyboard. */
  setFocused: (focused: boolean) => void;
  /** Forget what was sent so far. */
  clear: () => void;
  /** The ConversationMarkRead requests that reached the agent. */
  markReads: () => unknown[];
  /** What each ReportFocus said, in order. */
  focusReports: () => Array<{ session_cid: bigint; peer_cid: bigint | null; focused: boolean }>;
}

type FocusReport = { session_cid: bigint; peer_cid: bigint | null; focused: boolean };
function focusReportOf(request: Record<string, unknown>): FocusReport | null {
  const command: unknown = (request.ConnectionManagement as { management_command?: { ReportFocus?: FocusReport } } | undefined)?.management_command;
  return (command as { ReportFocus?: FocusReport } | undefined)?.ReportFocus ?? null;
}

function fakeAgentSocket(): DeclaringClient {
  let match: ((m: InternalServiceResponse) => unknown) | null = null;
  let settle: ((v: unknown) => void) | null = null;
  return {
    async sendDirectToInternalService(request: InternalServiceRequest): Promise<void> {
      const id: unknown = (request as { ConnectionManagement: { request_id: string } }).ConnectionManagement.request_id;
      settle?.(match?.({ AgentCapabilities: { request_id: id, agent_ilm: true } } as unknown as InternalServiceResponse));
    },
    nextResponse<T>(extract: (m: InternalServiceResponse) => T | undefined): Promise<T> {
      match = extract;
      return new Promise<T>((resolve) => { settle = resolve as (v: unknown) => void; });
    },
  };
}

export async function installHostingAgent(): Promise<HostingAgent> {
  forgetCapabilities();
  registerCapabilityRoute({ isLeader: () => true, askLeader: async () => ({ agentIlm: true, supervisesP2p: false, noticesHeard: false, stagesUploads: false, takesConsole: false, servesApps: false }) });
  const greeting: Greeting = watchGreeting();
  greeting.observe({ ServiceConnectionAccepted: { cid: 0n, request_id: null, agent_ilm: true } } as never);
  await declareOnLeaderSocket(fakeAgentSocket(), greeting);
  instanceManager.setCid(OWN);
  let sent: Array<Record<string, unknown>> = [];
  let focused: boolean = false;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  registerConversationSender(async (request: Record<string, unknown>): Promise<void> => {
    sent.push(request);
    const [variant, body] = Object.entries(request)[0] as [string, { request_id: string }];
    if (variant === 'ConversationMarkRead') {
      queueMicrotask(() => eventEmitter.emit('websocket-message', { ConversationUpdated: { request_id: body.request_id, message: null } }));
    }
  });
  vi.spyOn(P2PMessengerManager.getInstance(), 'waitForReady').mockResolvedValue(undefined as never);
  return {
    setFocused: (f: boolean): void => { focused = f; },
    clear: (): void => { sent = []; },
    markReads: (): unknown[] => sent.filter((r) => 'ConversationMarkRead' in r),
    focusReports: (): FocusReport[] => sent.map(focusReportOf).filter((r): r is FocusReport => r !== null),
  };
}

export const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };
