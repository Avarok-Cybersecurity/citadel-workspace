import { describe, expect, it } from 'vitest';
import type { AppEvent } from '../../sdk/generated/AppEvent';
import { onStorageChanged } from '../storage-changed';

/** The page's push stream, as a list of listeners a test can push to. */
function pushStream(): { pushes: (l: (a: unknown) => void) => () => void; push: (a: unknown) => void } {
  const listeners: Set<(a: unknown) => void> = new Set();
  return {
    pushes: (l: (a: unknown) => void): (() => void) => { listeners.add(l); return (): void => { listeners.delete(l); }; },
    push: (a: unknown): void => { for (const l of listeners) l(a); },
  };
}

const changed = (installId: string, keys: string[]): unknown => ({
  StorageChanged: { install_id: installId, backend: { node_authored: { node_id: 'room', author: 'ana' } }, keys },
});

describe('StorageChanged reaches the running instances of the install that wrote, only', () => {
  it('delivers one event per key to an instance of the same install', () => {
    const s: { pushes: (l: (a: unknown) => void) => () => void; push: (a: unknown) => void; } = pushStream();
    const heard: AppEvent[] = [];
    onStorageChanged(s.pushes, 'cal-1', (e: AppEvent): void => { heard.push(e); });
    s.push(changed('cal-1', ['cal/rsvp/1', 'cal/rsvp/2']));
    expect(heard).toEqual([
      { storage_changed: { backend: { node_authored: { node_id: 'room', author: 'ana' } }, key: 'cal/rsvp/1' } },
      { storage_changed: { backend: { node_authored: { node_id: 'room', author: 'ana' } }, key: 'cal/rsvp/2' } },
    ]);
  });

  it('tells an instance of another install nothing', () => {
    const s: { pushes: (l: (a: unknown) => void) => () => void; push: (a: unknown) => void; } = pushStream();
    const heard: AppEvent[] = [];
    onStorageChanged(s.pushes, 'kanban-1', (e: AppEvent): void => { heard.push(e); });
    s.push(changed('cal-1', ['cal/rsvp/1']));
    expect(heard).toEqual([]);
  });

  it('ignores a push that carries a value or a store the server never announces', () => {
    const s: { pushes: (l: (a: unknown) => void) => () => void; push: (a: unknown) => void; } = pushStream();
    const heard: AppEvent[] = [];
    onStorageChanged(s.pushes, 'cal-1', (e: AppEvent): void => { heard.push(e); });
    s.push({ StorageChanged: { install_id: 'cal-1', backend: { node: { node_id: 'room' } }, keys: ['k'], value: [1] } });
    s.push({ StorageChanged: { install_id: 'cal-1', backend: 'user', keys: ['k'] } });
    expect(heard).toEqual([]);
  });

  it('stops delivering once unsubscribed', () => {
    const s: { pushes: (l: (a: unknown) => void) => () => void; push: (a: unknown) => void; } = pushStream();
    const heard: AppEvent[] = [];
    const off: () => void = onStorageChanged(s.pushes, 'cal-1', (e: AppEvent): void => { heard.push(e); });
    off();
    s.push(changed('cal-1', ['k']));
    expect(heard).toEqual([]);
  });
});
