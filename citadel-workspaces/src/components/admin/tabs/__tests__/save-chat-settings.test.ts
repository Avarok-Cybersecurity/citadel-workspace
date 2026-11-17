import { describe, it, expect, vi  } from 'vitest';
import { saveChatSettings, MAX_CHAT_RULES_LENGTH , type ChatSettingsNotice } from '../save-chat-settings';

function deps(overrides: Partial<Parameters<typeof saveChatSettings>[0]> = {}): {
  notices: ChatSettingsNotice[];
  write: ReturnType<typeof vi.fn>;
  args: Parameters<typeof saveChatSettings>[0];
} {
  const notices: ChatSettingsNotice[] = [];
  const write: ReturnType<typeof vi.fn> = vi.fn((): Promise<void> => Promise.resolve());
  return {
    notices,
    write,
    args: {
      entityType: 'office',
      entityId: 'node-1',
      chatEnabled: true,
      chatRules: 'Be kind',
      write,
      notify: (n: ChatSettingsNotice): number => notices.push(n),
      log: (): void => {},
      ...overrides,
    },
  };
}

describe('saveChatSettings', () => {
  it('sends both fields and confirms only after the write resolves', async () => {
    const d: ReturnType<typeof deps> = deps({ chatEnabled: false, chatRules: 'No spam' });
    const result: boolean = await saveChatSettings(d.args);

    expect(result).toBe(true);
    expect(d.write).toHaveBeenCalledWith('node-1', { chatEnabled: false, rules: 'No spam' });
    expect(d.notices).toEqual([
      { kind: 'success', title: 'Chat settings updated', description: 'Chat disabled for this office' },
    ]);
  });

  it('reports failure and does not claim success when the write rejects', async () => {
    const write: ReturnType<typeof vi.fn> = vi.fn((): Promise<never> => Promise.reject(new Error('offline')));
    const d: ReturnType<typeof deps> = deps({ write });

    const result: boolean = await saveChatSettings(d.args);

    expect(result).toBe(false);
    expect(d.notices).toHaveLength(1);
    expect(d.notices[0].kind).toBe('error');
  });

  it('refuses the workspace level instead of reporting a save it cannot make', async () => {
    // UpdateWorkspace carries no chat fields, so there is nowhere to put these.
    const d: ReturnType<typeof deps> = deps({ entityType: 'workspace' });

    const result: boolean = await saveChatSettings(d.args);

    expect(result).toBe(false);
    expect(d.write).not.toHaveBeenCalled();
    expect(d.notices[0]).toMatchObject({ kind: 'error', title: 'Not available for the workspace' });
  });

  it('refuses when the node id has not loaded yet', async () => {
    const d: ReturnType<typeof deps> = deps({ entityId: '' });

    const result: boolean = await saveChatSettings(d.args);

    expect(result).toBe(false);
    expect(d.write).not.toHaveBeenCalled();
  });

  it('rejects over-long rules before sending them', async () => {
    const d: ReturnType<typeof deps> = deps({ chatRules: 'x'.repeat(MAX_CHAT_RULES_LENGTH + 1) });

    const result: boolean = await saveChatSettings(d.args);

    expect(result).toBe(false);
    expect(d.write).not.toHaveBeenCalled();
    expect(d.notices[0].description).toContain(String(MAX_CHAT_RULES_LENGTH));
  });

  it('accepts rules exactly at the limit', async () => {
    const d: ReturnType<typeof deps> = deps({ chatRules: 'x'.repeat(MAX_CHAT_RULES_LENGTH) });

    await expect(saveChatSettings(d.args)).resolves.toBe(true);
    expect(d.write).toHaveBeenCalled();
  });

  it('allows clearing the rules', async () => {
    const d: ReturnType<typeof deps> = deps({ chatRules: '' });

    await expect(saveChatSettings(d.args)).resolves.toBe(true);
    expect(d.write).toHaveBeenCalledWith('node-1', { chatEnabled: true, rules: '' });
  });
});
