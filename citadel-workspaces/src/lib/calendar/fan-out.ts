/**
 * Down is a push by the publisher (design 3.5, C7): after an official event is saved, its
 * publisher's client brings every page below it in line with it, by the core's plan
 * (`fanOutPlan`): a projection into each while it propagates down and is not cancelled, a delete
 * otherwise. Each write is the kernel's to allow: the publisher needs `EditMdx` on each page,
 * which an editor of the origin holds by inheritance. Nothing here pre-empts that; a page the
 * kernel refuses is reported by name with the kernel's reason, and the rest are still written.
 *
 * The plan is idempotent, so a partial failure is repaired by saving again.
 */
import type { CalendarEngine } from './engine/calendar-engine';
import type { Event } from './generated/Event';
import type { Write } from './generated/Write';
import { PortRefused, refusalCopy, type CalendarPorts } from './ports';
import { descendantsOf } from './tree-walk';

export interface FanOutFailure {
  readonly node: string;
  readonly reason: string;
}

export interface FanOutResult {
  /** Pages the plan touched. */
  readonly planned: number;
  readonly failed: readonly FanOutFailure[];
}

export type Progress = (done: number, of: number) => void;

function reasonOf(error: unknown): string {
  if (error instanceof PortRefused) return refusalCopy(error.refused);
  throw error;
}

async function apply(ports: CalendarPorts, engine: CalendarEngine, write: Write): Promise<void> {
  if ('put' in write) {
    const { node, key, projection } = write.put;
    await ports.storage.set({ kind: 'node', node }, key, engine.encodeProjection(projection));
    return;
  }
  await ports.storage.remove({ kind: 'node', node: write.delete.node }, write.delete.key);
}

/** The writes that bring the pages below `event`'s origin in line with it. A core refusal (more pages than the bound, a private event) is thrown. */
export async function planFanOut(ports: CalendarPorts, engine: CalendarEngine, event: Event): Promise<Write[]> {
  const subtree: string[] = await descendantsOf(ports, event.origin_node, engine.propagationBounds().fan_out);
  return engine.fanOutPlan(event, subtree);
}

/** Applies every write of `plan`; a write the kernel refuses is reported and the rest still go. */
export async function applyFanOut(ports: CalendarPorts, engine: CalendarEngine, plan: readonly Write[], progress: Progress): Promise<FanOutResult> {
  const failed: FanOutFailure[] = [];
  for (const [i, write] of plan.entries()) {
    try {
      await apply(ports, engine, write);
    } catch (error: unknown) {
      failed.push({ node: 'put' in write ? write.put.node : write.delete.node, reason: reasonOf(error) });
    }
    progress(i + 1, plan.length);
  }
  return { planned: plan.length, failed };
}
