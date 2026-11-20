/**
 * How a window's requests reach the agent, set once by the websocket service.
 *
 * Its own module so the service can set it without loading the requests
 * themselves (requests.ts), which only a window talking to a 0.8.6 agent
 * needs: they stay off the landing page's critical path (check-bundle-budget).
 */
export type RequestSender = (request: Record<string, unknown>, requestId?: string) => Promise<void>;

let sender: RequestSender | null = null;

export function registerConversationSender(send: RequestSender): void {
  sender = send;
}

export function conversationSender(): RequestSender | null {
  return sender;
}

/** A request with no answer to wait for (ReportFocus): sent, and that is all. */
export function sendToAgent(request: Record<string, unknown>): Promise<void> {
  if (!sender) return Promise.reject(new Error('The websocket service is not ready'));
  return sender(request);
}

/** `variant`'s body in an agent answer (bare, or under `Response`), if it answers `requestId`. */
export function answerTo(message: Record<string, unknown>, variant: string, requestId: string): Record<string, unknown> | undefined {
  const body: Record<string, unknown> = (message.Response as Record<string, unknown> | undefined) ?? message;
  const value: unknown = body[variant];
  if (typeof value !== 'object' || value === null) return undefined;
  const v: Record<string, unknown> = value as Record<string, unknown>;
  return v.request_id === requestId ? v : undefined;
}
