/**
 * A node's routing forms (design §3.6.3): `cal/routing/<id>` in the node's own store, written by
 * its `EditMdx` holders. The booker answers the form's questions and the core routes them, the
 * first rule that holds or else the fallback; the target then runs the ordinary booking flow, so a
 * form grants nothing a booker could not already do.
 */
import type { CalendarEngine } from './engine/calendar-engine';
import type { Answer } from './generated/Answer';
import type { RoutingForm } from './generated/RoutingForm';
import type { RoutingTarget } from './generated/RoutingTarget';
import type { CalendarPorts, CalendarStore } from './ports';

export const ROUTING_PREFIX: string = 'cal/routing/';

const nodeStore = (node: string): CalendarStore => ({ kind: 'node', node });

/** Saves `form` on `node` once the core accepts it. */
export async function saveRoutingForm(ports: CalendarPorts, engine: CalendarEngine, node: string, form: RoutingForm): Promise<void> {
  engine.team.checkRoutingForm(form);
  await ports.storage.set(nodeStore(node), `${ROUTING_PREFIX}${form.id}`, engine.team.encodeRoutingForm(form));
}

export const removeRoutingForm = (ports: CalendarPorts, node: string, id: string): Promise<void> =>
  ports.storage.remove(nodeStore(node), `${ROUTING_PREFIX}${id}`);

export async function readRoutingForms(ports: CalendarPorts, engine: CalendarEngine, node: string): Promise<{ forms: RoutingForm[]; unreadable: number }> {
  const keys: string[] = await ports.storage.keys(nodeStore(node), ROUTING_PREFIX);
  const forms: RoutingForm[] = [];
  let unreadable: number = 0;
  for (const key of keys) {
    const bytes: Uint8Array | null = await ports.storage.get(nodeStore(node), key);
    if (bytes === null) continue;
    try {
      forms.push(engine.team.decodeRoutingForm(bytes));
    } catch {
      unreadable += 1;
    }
  }
  return { forms: forms.sort((a: RoutingForm, b: RoutingForm) => a.name.localeCompare(b.name)), unreadable };
}

/** Where `answers` send the booker; the core's refusal (unanswered, not an option) is thrown. */
export const routeAnswers = (engine: CalendarEngine, form: RoutingForm, answers: Answer[]): RoutingTarget => engine.team.route(form, answers);
