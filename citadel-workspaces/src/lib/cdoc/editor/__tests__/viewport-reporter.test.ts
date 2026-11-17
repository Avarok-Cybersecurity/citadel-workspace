/** The viewport report: one send per frame with the latest pages, and never the same set twice. */
import { describe, expect, it } from 'vitest';
import { viewportReporter } from '../viewport-reporter';

interface Frames { readonly schedule: (task: () => void) => void; readonly flush: () => void }

function frames(): Frames {
  const queued: Array<() => void> = [];
  return {
    schedule: (task: () => void): void => { queued.push(task); },
    flush: (): void => { for (const task of queued.splice(0)) task(); },
  };
}

describe('the viewport reporter', () => {
  it('sends the latest pages once per frame', () => {
    const sent: number[][] = [];
    const f: Frames = frames();
    const report: (pages: readonly number[]) => void = viewportReporter((p: readonly number[]) => sent.push([...p]), f.schedule);
    report([0, 1]);
    report([1, 2]);
    report([2, 3]);
    expect(sent).toEqual([]);
    f.flush();
    expect(sent).toEqual([[2, 3]]);
  });

  it('does not resend a set the editor already has', () => {
    const sent: number[][] = [];
    const f: Frames = frames();
    const report: (pages: readonly number[]) => void = viewportReporter((p: readonly number[]) => sent.push([...p]), f.schedule);
    report([0, 1]);
    f.flush();
    report([0, 1]);
    f.flush();
    report([1, 2]);
    f.flush();
    expect(sent).toEqual([[0, 1], [1, 2]]);
  });
});
