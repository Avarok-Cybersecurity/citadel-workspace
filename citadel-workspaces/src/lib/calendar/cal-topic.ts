/**
 * The `cal` topic (design 3.5): one group per install, on which a window says "this key on this
 * node changed" after it writes, so the Calendar's other windows (other members' too) re-read it
 * with their own rights instead of polling. A message is the core's `CalChange`, `{ node, key }`
 * and nothing else (the core refuses any other shape), so a topic never carries event content.
 *
 * The topic is a hint beside the kernel's `StorageChanged`, never the record: a message that
 * cannot be sent or read is reported on the console and the stored value stays the truth.
 */
import type { TopicArrival } from '@/lib/citadel-apps/host/ports';
import type { CalendarEngine } from './engine/calendar-engine';
import type { CalChange } from './generated/CalChange';
import { PortRefused, type CalendarPorts } from './ports';
import type { Unsubscribe } from '@/lib/citadel-apps/host/glue-instance';

export const CAL_TOPIC: string = 'cal';

type TopicPorts = Pick<CalendarPorts, 'topics'>;

/** A refusal is reported, not thrown: the topic is a hint. Anything else is a fault and is rethrown. */
const reportRefusal = (what: string) => (error: unknown): void => {
  if (!(error instanceof PortRefused)) throw error;
  console.warn(`[calendar] ${what}`, error.message);
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
  void ports.topics.open(CAL_TOPIC).catch(reportRefusal('the cal topic could not be joined; changes arrive by storage only'));
  return (): void => {
    live = false;
    off();
    void ports.topics.close(CAL_TOPIC).catch(reportRefusal('the cal topic could not be left'));
  };
}
