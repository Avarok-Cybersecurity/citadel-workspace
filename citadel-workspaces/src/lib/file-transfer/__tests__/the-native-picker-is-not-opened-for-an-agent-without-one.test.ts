/**
 * Defence in depth behind the hidden button: a native-picker send for an agent that said
 * `native_picker: false` stops before it asks that agent for a dialog it cannot show, and
 * says so in the words the dialog already treats as "no picker here".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { sendFileWithNativePicker } from '../send-with-native-picker';
import { agentNativePicker, forgetCapabilities } from '@/lib/agent-conversations/capabilities';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';
import type { LifecycleDeps } from '../transfer-lifecycle';
import { ONLINE_PEER_QUEUE } from './online-peer-queue';

afterEach(() => { forgetCapabilities(); });

function harness(): { deps: LifecycleDeps; intents: string[] } {
  const intents: string[] = [];
  const deps: LifecycleDeps = {
    io: {
      getCurrentCid: async (): Promise<bigint> => 100n,
      executeIntent: async (intent: { type: string }): Promise<unknown> => {
        intents.push(intent.type);
        return intent.type === 'pick-file' ? { file_path: '/a/b.txt', file_name: 'b.txt', file_size: 3n } : undefined;
      },
    },
    state: { setTransfer: (): void => undefined },
    saveTransfer: async (): Promise<void> => undefined,
    emitStateChange: (): void => undefined,
    saveSettings: async (): Promise<void> => undefined,
    openPeerChannel: async (): Promise<boolean> => true,
    agentStagesUploads: async (): Promise<boolean> => true,
    agentNativePicker,
    queue: ONLINE_PEER_QUEUE,
  } as unknown as LifecycleDeps;
  return { deps, intents };
}

describe('sending with the native picker', () => {
  it('is refused, without a pick, when the agent says it has no picker', async () => {
    await greetAs(true, { native_picker: false });
    const { deps, intents } = harness();
    await expect(sendFileWithNativePicker(deps, '42')).rejects.toThrow(/File picker not available/);
    expect(intents).not.toContain('pick-file');
  });

  it('NEGATIVE CONTROL: an agent that says nothing is asked for the dialog as before', async () => {
    await greetAs('older');
    const { deps, intents } = harness();
    await sendFileWithNativePicker(deps, '42');
    expect(intents).toContain('pick-file');
  });
});
