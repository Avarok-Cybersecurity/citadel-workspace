/**
 * Console lines go only to an agent whose greeting says `browser_console`. An older agent's
 * greeting never mentions it, and must read as "no", or the page would send it a request it
 * cannot parse. Real: watchGreeting.
 */
import { describe, expect, it } from 'vitest';
import { watchGreeting, type AgentCapabilities } from '@/lib/agent-conversations/capabilities';

async function offers(greeting: Record<string, unknown>): Promise<AgentCapabilities> {
  const watch: ReturnType<typeof watchGreeting> = watchGreeting();
  watch.observe({ ServiceConnectionAccepted: greeting });
  return watch.offers;
}

describe('the greeting', () => {
  it('reads browser_console, and its absence as no', async () => {
    expect((await offers({ agent_ilm: true, browser_console: true })).takesConsole).toBe(true);
    expect((await offers({ agent_ilm: true, stages_uploads: true })).takesConsole).toBe(false);
    expect((await offers({ agent_ilm: true, browser_console: 'true' })).takesConsole).toBe(false);
  });
});
