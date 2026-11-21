/**
 * An app's agent ports (AppFetch, AppKv) are bound only for an agent whose greeting says `apps`.
 * An older agent's greeting never mentions it and must read as "no", or the page would send it
 * requests it cannot parse. Real: watchGreeting.
 */
import { describe, expect, it } from 'vitest';
import { watchGreeting, type AgentOffers } from '@/lib/agent-conversations/capabilities';

async function offers(greeting: Record<string, unknown>): Promise<AgentOffers> {
  const watch: ReturnType<typeof watchGreeting> = watchGreeting();
  watch.observe({ ServiceConnectionAccepted: greeting });
  return watch.offers;
}

describe('the greeting', () => {
  it('reads apps, and its absence (or anything but true) as no', async () => {
    expect((await offers({ apps: true })).servesApps).toBe(true);
    expect((await offers({ browser_console: true })).servesApps).toBe(false);
    expect((await offers({ apps: 'true' })).servesApps).toBe(false);
  });
});
