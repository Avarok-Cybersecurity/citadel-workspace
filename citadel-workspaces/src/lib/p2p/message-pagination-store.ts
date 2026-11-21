/**
 * The conversation store a window reads: the agent's (agent-conversations/agent-store.ts).
 *
 * The agent hosts every account's conversations and is the only writer of their
 * records; a window reads them through it and carries out compound actions with
 * the messenger (agent-actions.ts).
 */
export { agentStore as messagePaginationStore, type AgentStore as MessagePaginationStore } from '../agent-conversations/agent-store';
