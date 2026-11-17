/** The title bar's status and the unload warning, from where a document's edits are. Pure. */
import { describe, expect, it } from 'vitest';
import { saveStatus, warnsOnUnload, type SaveInputs, type SaveStatus } from '@/lib/document-save/save-status';
import { SAVE_STATUS_TEXT } from '@/lib/document-save/save-status-text';

const AT_REST: SaveInputs = { autoSave: true, link: 'up', unacknowledged: 0, syncRequested: false, local: 'written', halted: false, locked: false };
const held = (changes: Partial<SaveInputs>): SaveInputs => ({ ...AT_REST, unacknowledged: 2, ...changes });

describe('the save status', () => {
  it.each<[string, SaveInputs, SaveStatus]>([
    ['everything acknowledged, whatever else', { ...AT_REST, autoSave: false, link: 'down', local: 'failed', halted: true }, 'saved'],
    ['AutoSave on, sending', held({}), 'saving'],
    ['AutoSave on, link down', held({ link: 'down' }), 'offline'],
    ['AutoSave off, kept on the device', held({ autoSave: false }), 'savedToDevice'],
    ['AutoSave off, Save pressed', held({ autoSave: false, syncRequested: true }), 'saving'],
    ['AutoSave off, Save pressed offline', held({ autoSave: false, syncRequested: true, link: 'down' }), 'offline'],
    // Every keystroke starts one, and it takes milliseconds: a save under way, not unsaved.
    ['a write to the device in flight, AutoSave on', held({ local: 'writing' }), 'saving'],
    ['a write to the device in flight, AutoSave off', held({ autoSave: false, local: 'writing' }), 'saving'],
    ['this device keeps no copy at all', held({ local: 'unavailable' }), 'unsavedOnDevice'],
    ['a write to the device failed', held({ autoSave: false, local: 'failed' }), 'unsavedOnDevice'],
    ['the server refuses the edits, kept here', held({ halted: true }), 'refused'],
    ['the server refuses the edits, and this device could not keep them', held({ halted: true, local: 'failed' }), 'unsavedOnDevice'],
    ['copies kept here are locked', { ...AT_REST, locked: true }, 'locked'],
    ['locked, edits written here and on their way', held({ locked: true }), 'locked'],
    ['locked, and edits not yet written here: losing them comes first', held({ locked: true, local: 'failed' }), 'unsavedOnDevice'],
  ])('%s', (_name: string, inputs: SaveInputs, status: SaveStatus) => {
    expect(saveStatus(inputs)).toBe(status);
  });

  it('warns on unload only when edits are neither acknowledged nor written to this device', () => {
    expect(warnsOnUnload(held({ local: 'writing' }))).toBe(true);
    expect(warnsOnUnload(held({ local: 'failed' }))).toBe(true);
    expect(warnsOnUnload(held({ local: 'unavailable' }))).toBe(true);
    expect(warnsOnUnload(held({ autoSave: false }))).toBe(false);
    expect(warnsOnUnload(held({ halted: true }))).toBe(false);
    expect(warnsOnUnload({ ...AT_REST, local: 'failed' })).toBe(false);
  });

  it('has a label and what it means for every status', () => {
    const labels: Record<string, string> = Object.fromEntries(Object.entries(SAVE_STATUS_TEXT).map(([status, words]) => [status, words.label]));
    expect(labels).toEqual({
      saved: 'All changes saved',
      saving: 'Saving…',
      offline: 'Offline',
      savedToDevice: 'Saved to this device',
      unsavedOnDevice: 'Not saved to this device',
      refused: 'Not saved',
      locked: 'Locked on this device',
    });
    for (const words of Object.values(SAVE_STATUS_TEXT)) expect(words.detail.length).toBeGreaterThan(words.label.length);
  });
});
