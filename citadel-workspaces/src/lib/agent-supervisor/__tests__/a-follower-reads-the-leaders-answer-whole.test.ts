/**
 * A follower asks its leader what the agent said, over the instance channel,
 * and reads both capabilities from the ack. Real: askLeaderForCapabilities.
 * Stood in: the channel to the leader (a BroadcastChannel, absent in jsdom),
 * recorded and answered with what a leader's ack carries.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { askLeaderForCapabilities } from '@/lib/websocket-service/module-init';
import { instanceChannel } from '@/lib/multi-instance';

function leaderSays(data: unknown, status: 'processed' | 'error' = 'processed'): void {
  vi.spyOn(instanceChannel, 'sendToLeader').mockResolvedValue({ status, data, error: 'no leader' } as never);
}
afterEach((): void => { vi.restoreAllMocks(); });

describe('the follower\'s reading of the leader\'s ack', () => {
  it('takes both capabilities', async (): Promise<void> => {
    leaderSays({ agentIlm: true, supervisesP2p: true });
    expect(await askLeaderForCapabilities()).toEqual({ agentIlm: true, supervisesP2p: true, noticesHeard: false, stagesUploads: false, takesConsole: false, servesApps: false });
    leaderSays({ agentIlm: false, supervisesP2p: true });
    expect(await askLeaderForCapabilities()).toEqual({ agentIlm: false, supervisesP2p: true, noticesHeard: false, stagesUploads: false, takesConsole: false, servesApps: false });
    leaderSays({ agentIlm: true, supervisesP2p: false });
    expect(await askLeaderForCapabilities()).toEqual({ agentIlm: true, supervisesP2p: false, noticesHeard: false, stagesUploads: false, takesConsole: false, servesApps: false });
  });

  it('reads a leader that predates the capability as not supervising', async (): Promise<void> => {
    leaderSays({ agentIlm: true });
    expect(await askLeaderForCapabilities()).toEqual({ agentIlm: true, supervisesP2p: false, noticesHeard: false, stagesUploads: false, takesConsole: false, servesApps: false });
  });

  it('takes whether the agent stages uploads', async (): Promise<void> => {
    leaderSays({ agentIlm: true, supervisesP2p: false, stagesUploads: true });
    expect(await askLeaderForCapabilities()).toEqual({ agentIlm: true, supervisesP2p: false, noticesHeard: false, stagesUploads: true, takesConsole: false, servesApps: false });
  });

  it('takes whether a notifier is attached to the agent, and a leader that does not say as none', async (): Promise<void> => {
    leaderSays({ agentIlm: true, supervisesP2p: false, noticesHeard: true, stagesUploads: false, takesConsole: false, servesApps: false });
    expect(await askLeaderForCapabilities()).toEqual({ agentIlm: true, supervisesP2p: false, noticesHeard: true, stagesUploads: false, takesConsole: false, servesApps: false });
    leaderSays({ agentIlm: true, supervisesP2p: false });
    expect(await askLeaderForCapabilities()).toEqual({ agentIlm: true, supervisesP2p: false, noticesHeard: false, stagesUploads: false, takesConsole: false, servesApps: false });
  });

  it('takes whether the agent serves apps, and a leader that does not say as no', async (): Promise<void> => {
    leaderSays({ agentIlm: true, supervisesP2p: false, servesApps: true });
    expect((await askLeaderForCapabilities()).servesApps).toBe(true);
    leaderSays({ agentIlm: true, supervisesP2p: false });
    expect((await askLeaderForCapabilities()).servesApps).toBe(false);
  });

  it('takes whether the agent takes console lines, and a leader that does not say as no', async (): Promise<void> => {
    leaderSays({ agentIlm: true, supervisesP2p: false, takesConsole: true });
    expect((await askLeaderForCapabilities()).takesConsole).toBe(true);
    leaderSays({ agentIlm: true, supervisesP2p: false, takesConsole: 'yes' });
    expect((await askLeaderForCapabilities()).takesConsole).toBe(false);
  });

  it('reads an empty ack as neither', async (): Promise<void> => {
    leaderSays(undefined);
    expect(await askLeaderForCapabilities()).toEqual({ agentIlm: false, supervisesP2p: false, noticesHeard: false, stagesUploads: false, takesConsole: false, servesApps: false });
  });

  it('fails when the leader could not answer', async (): Promise<void> => {
    leaderSays(undefined, 'error');
    await expect(askLeaderForCapabilities()).rejects.toThrow('could not say');
  });
});
