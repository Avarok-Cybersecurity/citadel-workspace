/**
 * The `cal` topic (design 3.5): one group per install, on which a window says "this key on this
 * node changed" after it writes, so the Calendar's other windows (other members' too) re-read it
 * with their own rights instead of polling. A message is the core's `CalChange`, `{ node, key }`
 * and nothing else (the core refuses any other shape), so a topic never carries event content.
 *
 * The topic is a hint beside the kernel's `StorageChanged`, never the record: a message that
 * cannot be sent or read is reported on the console and the stored value stays the truth.
 *
 * Leaving has two hands by design: the Calendar's own, when its pane goes (the instance may stay),
 * and the host's, which leaves every topic an instance held when the instance ends (topic-port.ts
 * `closeAll`). When the instance ends first (a tree navigation rebinds it), the Calendar's leave
 * reaches a closed instance and is refused `closed`: the host's leave already did it, so that
 * refusal is the leave done, not a fault. A join still queued when the instance ends is refused
 * the same way, and there is nothing left to join.
 */
import type { TopicArrival } from '@/lib/citadel-apps/host/ports';
import type { CalendarEngine } from './engine/calendar-engine';
import type { CalChange } from './generated/CalChange';
import { PortRefused, type CalendarPorts } from './ports';
import { REFUSED_CLOSED } from '@/lib/citadel-apps/sdk/generated/AbiConstants';
import type { Unsubscribe } from '@/lib/citadel-apps/host/glue-instance';

export const CAL_TOPIC: string = 'cal';

type TopicPorts = Pick<CalendarPorts, 'topics'>;

/** A refusal is reported, not thrown: the topic is a hint. Anything else is a fault and is rethrown. */
const reportRefusal = (what: string) => (error: unknown): void => {
  if (!(error instanceof PortRefused)) throw error;
  console.warn(`[calendar] ${what}`, error.message);
};

/** The instance itself is closed: whatever it held open, its host let go of, so a join or a leave has nothing left to do. */
const unlessClosed = (what: string) => (error: unknown): void => {
  const closed: boolean = error instanceof PortRefused && typeof error.refused === 'object' && 'unavailable' in error.refused && error.refused.unavailable === REFUSED_CLOSED;
  if (!closed) reportRefusal(what)(error);
};

/** Tells the Calendar's other windows that `change.key` on `change.node` changed. */
export async function announce(ports: TopicPorts, engine: CalendarEngine, change: CalChange): Promise<void> {
  await ports.topics.publish(CAL_TOPIC, engine.encodeChange(change)).catch(reportRefusal('other windows were not told of a change'));
}

/** Joins the topic and hands each change another window announced to `onChange`; returns the leave. */
export function listenCal(ports: TopicPorts, engine: CalendarEngine, onChange: (change: CalChange) => void): () => void {
  let live: boolean = true;
  const off: Unsubscribe = ports.topics.onArrival((arrival: TopicArrival): void => {
    if (!live || arrival.name !== CAL_TOPIC || !('message' in arrival.event)) return;
    let change: CalChange;
    try {
      change = engine.decodeChange(arrival.event.message.body);
    } catch (error: unknown) {
      console.warn(`[calendar] ignored a cal message from ${arrival.event.message.from.username} that is not a change`, error);
      return;
    }
    onChange(change);
  });
  void ports.topics.open(CAL_TOPIC).catch(unlessClosed('the cal topic is not joined yet; changes arrive by storage until the host joins it (the page says why)'));
  return (): void => {
    live = false;
    off();
    void ports.topics.close(CAL_TOPIC).catch(unlessClosed('the cal topic could not be left'));
  };
}
