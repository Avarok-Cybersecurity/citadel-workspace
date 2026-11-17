/**
 * One ceiling, the one the agent can actually take: 2 GB staged through an agent that
 * says it stages uploads, 16 MiB inline through one that does not (an agent installed
 * before staging existed). The greeting decides; an older greeting reads as "inline".
 */
import { describe, it, expect } from 'vitest';
import { browserSendCeiling, browserSendRefusal, browserSendRoute } from '../send-route';
import { STAGED_UPLOAD_CEILING_BYTES } from '../chunk-plan';
import { MAX_BYTE_CONTENTS_BYTES } from '../../server-upload';
import { watchGreeting, type AgentCapabilities } from '@/lib/agent-conversations/capabilities';

const MB: number = 1024 * 1024;

describe('the browser send route', () => {
  it('stages through an agent that stages, and goes inline otherwise', () => {
    expect(browserSendRoute(true)).toBe('staged');
    expect(browserSendRoute(false)).toBe('inline');
    expect(browserSendCeiling(true)).toBe(STAGED_UPLOAD_CEILING_BYTES);
    expect(browserSendCeiling(false)).toBe(MAX_BYTE_CONTENTS_BYTES);
  });

  it('lets a 40 MB file through a staging agent and refuses it, saying why and what works, through an older one', () => {
    const video: Pick<File, 'name' | 'size'> = { name: 'video.mov', size: 40 * MB };
    expect(browserSendRefusal(video, true, true)).toBeNull();
    const why: string | null = browserSendRefusal(video, false, true);
    expect(why).toMatch(/up to 16 MB/);
    expect(why).toMatch(/Updating your Citadel agent/);
    expect(why).toMatch(/Browse Files/);
  });

  it('refuses over 2 GB even through a staging agent, and an empty file always', () => {
    expect(browserSendRefusal({ name: 'disk.img', size: STAGED_UPLOAD_CEILING_BYTES + 1 }, true, true)).toMatch(/up to 2 GB.*Max file size to accept/s);
    expect(browserSendRefusal({ name: 'e.txt', size: 0 }, true, true)).toMatch(/empty/);
  });
});

describe('the advice', () => {
  it('names Browse Files only when the dialog offers it', () => {
    const big: Pick<File, 'name' | 'size'> = { name: 'disk.img', size: STAGED_UPLOAD_CEILING_BYTES + 1 };
    expect(browserSendRefusal(big, true, true)).toMatch(/Browse Files/);
    expect(browserSendRefusal(big, true, false)).not.toMatch(/Browse Files/);
  });
});

describe('the greeting', () => {
  async function offers(greeting: Record<string, unknown>): Promise<AgentCapabilities> {
    const watch: ReturnType<typeof watchGreeting> = watchGreeting();
    watch.observe({ ServiceConnectionAccepted: greeting });
    return watch.offers;
  }

  it('reads stages_uploads, and its absence as no', async () => {
    expect((await offers({ agent_ilm: true, stages_uploads: true })).stagesUploads).toBe(true);
    expect((await offers({ agent_ilm: true })).stagesUploads).toBe(false);
  });
});
