import { describe, it, expect, vi  } from 'vitest';
import { saveOfficeContent } from '../save-office-content';

/**
 * Guards the two defects this logic used to have. Both were about telling the
 * user something untrue, which is worse than failing visibly.
 */
function deps(overrides: Partial<Parameters<typeof saveOfficeContent>[0]> = {}): Parameters<typeof saveOfficeContent>[0] {
  return {
    nodeId: 'node-1',
    content: '# hello',
    displayName: 'Engineering',
    noPageReason: 'There is no page to save to.',
    write: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

describe('saveOfficeContent', () => {
  it('writes the content and confirms it', async () => {
    const d: ReturnType<typeof deps> = deps();

    await expect(saveOfficeContent(d)).resolves.toBe(true);

    expect(d.write).toHaveBeenCalledWith('node-1', '# hello');
    expect(d.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'Changes saved' })
    );
  });

  it('refuses to save with no node, and does not claim it did', async () => {
    const d: ReturnType<typeof deps> = deps({ nodeId: undefined });

    await expect(saveOfficeContent(d)).resolves.toBe(false);

    // The original defect: the write sat inside `if (nodeId)` and the success
    // toast did not, so nothing was persisted and the user was told otherwise.
    expect(d.write).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
    expect(d.notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
    // Says why, rather than "still loading" about a page that had finished.
    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({ description: 'There is no page to save to.' }));
  });

  it('reports a failed write as a failure', async () => {
    const d: ReturnType<typeof deps> = deps({ write: vi.fn().mockRejectedValue(new Error('offline')) });

    await expect(saveOfficeContent(d)).resolves.toBe(false);

    expect(d.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', title: 'Error saving changes' })
    );
    expect(d.notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
    // Returning false is what keeps the editor open. setIsEditing(false) used to
    // run regardless of outcome, so a failed save also threw away the text.
  });

  it('logs the failure rather than swallowing it', async () => {
    const error: Error = new Error('offline');
    const d: ReturnType<typeof deps> = deps({ write: vi.fn().mockRejectedValue(error) });

    await saveOfficeContent(d);

    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('Failed to save'), error);
  });

  it('names the page in the confirmation', async () => {
    const d: ReturnType<typeof deps> = deps({ displayName: 'Design' });

    await saveOfficeContent(d);

    expect(d.notify).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('Design') })
    );
  });
});
