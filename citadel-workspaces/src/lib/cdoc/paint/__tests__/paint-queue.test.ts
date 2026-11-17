/**
 * The paint queue's contract: one paint at a time (the cap), pages in view before pages painted
 * ahead, a slot's newer request replacing its waiting one with both callers answered, a dropped
 * slot never painted, and a failing paint not stalling the line. Tasks are deferreds the test
 * settles by hand, so "running" is observed, never timed.
 */
import { describe, expect, it } from 'vitest';
import { PaintQueue } from '../paint-queue';

interface Deferred {
  readonly started: string[];
  task: (name: string) => () => Promise<string>;
  finish: (name: string) => Promise<void>;
  fail: (name: string) => Promise<void>;
}

/** Every microtask the queue chains (settle, then, finally, the next start) runs before a macrotask. */
const settle = (): Promise<void> => new Promise<void>((resolve): void => {
  setTimeout(resolve, 0);
});

function deferreds(): Deferred {
  const started: string[] = [];
  const open: Map<string, { resolve: (v: string) => void; reject: (e: unknown) => void }> = new Map();
  return {
    started,
    task: (name: string) => (): Promise<string> => new Promise<string>((resolve, reject): void => {
      started.push(name);
      open.set(name, { resolve, reject });
    }),
    finish: async (name: string): Promise<void> => {
      await settle();
      open.get(name)?.resolve(name);
      await settle();
    },
    fail: async (name: string): Promise<void> => {
      await settle();
      open.get(name)?.reject(new Error(name));
      await settle();
    },
  };
}


describe('the paint queue', () => {
  it('runs one paint at a time, and the next only when it finishes', async () => {
    const d: Deferred = deferreds();
    const q: PaintQueue = new PaintQueue(1);
    void q.run(1, 'visible', d.task('a'));
    void q.run(2, 'visible', d.task('b'));
    await settle();
    expect(d.started).toEqual(['a']);
    await d.finish('a');
    expect(d.started).toEqual(['a', 'b']);
  });

  it('paints a page in view before pages painted ahead that asked first', async () => {
    const d: Deferred = deferreds();
    const q: PaintQueue = new PaintQueue(1);
    void q.run(1, 'ahead', d.task('running'));
    void q.run(2, 'ahead', d.task('ahead'));
    void q.run(3, 'visible', d.task('visible'));
    await settle();
    await d.finish('running');
    expect(d.started).toEqual(['running', 'visible']);
  });

  it('replaces a slot\'s waiting paint with the newer one, and answers both callers with it', async () => {
    const d: Deferred = deferreds();
    const q: PaintQueue = new PaintQueue(1);
    void q.run(9, 'visible', d.task('busy'));
    const older: Promise<string> = q.run(1, 'ahead', d.task('older'));
    const newer: Promise<string> = q.run(1, 'visible', d.task('newer'));
    expect(q.pending).toBe(1);
    await d.finish('busy');
    await d.finish('newer');
    await expect(older).resolves.toBe('newer');
    await expect(newer).resolves.toBe('newer');
    expect(d.started).toEqual(['busy', 'newer']);
  });

  it('never paints a slot dropped while it waited', async () => {
    const d: Deferred = deferreds();
    const q: PaintQueue = new PaintQueue(1);
    void q.run(9, 'visible', d.task('busy'));
    void q.run(1, 'ahead', d.task('gone'));
    q.drop(1);
    await d.finish('busy');
    expect(d.started).toEqual(['busy']);
    expect(q.pending).toBe(0);
  });

  it('goes on after a paint fails, and that paint\'s caller gets the error', async () => {
    const d: Deferred = deferreds();
    const q: PaintQueue = new PaintQueue(1);
    // Observed from the start, so the rejection is handled the moment it happens.
    const failing: Promise<unknown> = q.run(1, 'visible', d.task('bad')).then((): unknown => null, (error: unknown): unknown => error);
    void q.run(2, 'visible', d.task('next'));
    await d.fail('bad');
    expect(await failing).toEqual(new Error('bad'));
    expect(d.started).toEqual(['bad', 'next']);
  });

  it('refuses a cap below one', () => {
    expect(() => new PaintQueue(0)).toThrow(/at least one/);
  });
});
