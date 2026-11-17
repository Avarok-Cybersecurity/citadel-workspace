/**
 * A workspace-settings save resolves on its OWN answer, not on another `Workspace` record.
 *
 * `Workspace` is also what a concurrent GetWorkspace answers and what every other member's save
 * broadcasts. Matched by type alone, one of those resolves the save: the dialog closes on
 * "saved" while the server is about to refuse it. The answer that carries every change made is
 * ours; a record still showing the old values is not.
 *
 * No mocks: the matcher is pure, over real metadata bytes.
 */
import { describe, it, expect } from 'vitest';
import { workspaceProfileIs } from '../response-matchers';

const PNG: string = 'data:image/png;base64,iVBORw0KGgo=';
const record = (name: string, logo: string | null): Record<string, unknown> => ({
  id: 'w1',
  name,
  description: '',
  metadata: Array.from(new TextEncoder().encode(JSON.stringify({ initialized: true, logo }))),
});

describe('the answer to a workspace-settings save', () => {
  it('is the record with the new name, not a read of the old one', () => {
    const ours: (p: unknown) => boolean = workspaceProfileIs('w1', { name: ' Avarok Labs ' });
    expect(ours(record('Avarok Labs', null))).toBe(true);
    expect(ours(record('Old name', null))).toBe(false);
    expect(ours({ ...record('Avarok Labs', null), id: 'w2' })).toBe(false);
  });

  it('is the record holding the new icon, or no icon after a clear', () => {
    expect(workspaceProfileIs('w1', { logo: { Set: { data_url: PNG } } })(record('n', PNG))).toBe(true);
    expect(workspaceProfileIs('w1', { logo: { Set: { data_url: PNG } } })(record('n', null))).toBe(false);
    expect(workspaceProfileIs('w1', { logo: 'Clear' })(record('n', null))).toBe(true);
    expect(workspaceProfileIs('w1', { logo: 'Clear' })(record('n', PNG))).toBe(false);
  });
});
