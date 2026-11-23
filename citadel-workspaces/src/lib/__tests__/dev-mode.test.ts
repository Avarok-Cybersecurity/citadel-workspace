/**
 * Dev mode's rules over a port: off until turned on, read once, shown only once saved.
 * The port is a double because it is the I/O edge; createDevMode is production.
 */
import { describe, it, expect } from 'vitest';
import { createDevMode, DEV_MODE_DEFAULT, readDevMode, type DevModePort } from '../dev-mode';

function port(stored: unknown, writes: { fail: boolean; saved: boolean[] } = { fail: false, saved: [] }): DevModePort {
  return {
    read: (): Promise<unknown> => Promise.resolve(stored),
    write: (on: boolean): Promise<void> => (writes.fail ? Promise.reject(new Error('quota')) : (writes.saved.push(on), Promise.resolve())),
  };
}

describe('readDevMode', () => {
  it('is off on a device that never chose', () => {
    expect(DEV_MODE_DEFAULT).toBe(false);
    expect(readDevMode(undefined)).toBe(false);
  });
  it('is what the device stored', () => {
    expect(readDevMode(true)).toBe(true);
    expect(readDevMode(false)).toBe(false);
  });
  it('refuses a record this client never writes', () => {
    expect(() => readDevMode('yes')).toThrow(/not in the shape/);
  });
});

describe('createDevMode', () => {
  it('is unknown until read, then the stored choice', async () => {
    const mode: ReturnType<typeof createDevMode> = createDevMode(port(true));
    expect(mode.store.get()).toBeNull();
    await mode.load();
    expect(mode.store.get()).toBe(true);
  });

  it('reads nothing stored as off', async () => {
    const mode: ReturnType<typeof createDevMode> = createDevMode(port(undefined));
    await mode.load();
    expect(mode.store.get()).toBe(false);
  });

  it('saves a change and shows it to every subscriber at once', async () => {
    const writes: { fail: boolean; saved: boolean[] } = { fail: false, saved: [] };
    const mode: ReturnType<typeof createDevMode> = createDevMode(port(undefined, writes));
    await mode.load();
    let heard: number = 0;
    mode.store.subscribe((): void => { heard += 1; });
    await mode.change(true);
    expect(writes.saved).toEqual([true]);
    expect(mode.store.get()).toBe(true);
    expect(heard).toBe(1);
  });

  it('shows nothing changed when the save fails', async () => {
    const mode: ReturnType<typeof createDevMode> = createDevMode(port(false, { fail: true, saved: [] }));
    await mode.load();
    await expect(mode.change(true)).rejects.toThrow('quota');
    expect(mode.store.get()).toBe(false);
  });
});
