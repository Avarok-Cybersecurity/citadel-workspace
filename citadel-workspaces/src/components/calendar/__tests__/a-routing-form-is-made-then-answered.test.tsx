/**
 * A routing form made in its editor is the one a booker answers (design §3.6.3): an editor adds a
 * question, two rules and a fallback, moves the second rule above the first, and saves; the form
 * read back from the node routes each answer as the rules now say, first rule first. A form whose
 * targets are not chosen is not saved, and says what is missing.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { realEngine } from '@/lib/calendar/__tests__/engine-rig';
import { portsRig } from '@/lib/calendar/__tests__/ports-rig';
import { INTRO } from '@/lib/calendar/__tests__/booking-fixture';
import type { EventType } from '@/lib/calendar/generated/EventType';
import type { RoutingForm } from '@/lib/calendar/generated/RoutingForm';
import { readRoutingForms, routeAnswers, saveRoutingForm } from '@/lib/calendar/routing-forms';
import { RoutingFormEditor } from '../RoutingFormEditor';
import type { CalendarPorts } from '@/lib/calendar/ports';
import type { MemoryStore } from '@/lib/calendar/__tests__/memory-store';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const NODE: { id: string; name: string; } = { id: 'n1', name: 'Platform' };
const ROTA: EventType = { ...INTRO, id: 'rr', name: 'Support rota', kind: { round_robin: { hosts: ['ana', 'bo'], strategy: 'equal' } } };

function editor(): ReturnType<typeof portsRig> {
  const rig: { store: MemoryStore; ports: CalendarPorts; } = portsRig('alice');
  let n: number = 0;
  render(
    <RoutingFormEditor engine={engine} id="f1" saved={null} node={NODE} members={['ana', 'bo']} teams={[ROTA]} newId={(): string => `q${(n += 1)}`}
      onSave={async (form: RoutingForm): Promise<string | null> => { await saveRoutingForm(rig.ports, engine, NODE.id, form); return null; }} onCancel={(): void => {}} />,
  );
  return rig;
}

const change = (label: string | RegExp, value: string, within_: HTMLElement = document.body): void => {
  fireEvent.change(within(within_).getByLabelText(label), { target: { value } });
};

describe('a routing form', () => {
  it('is saved as edited, rules in the order they were left, and routes answers by them', async () => {
    const rig: { store: MemoryStore; ports: CalendarPorts; } = editor();
    change('Form name', 'Talk to the right person');
    fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
    change('Question 1', 'What is it about?');
    change('Question 1 answer', 'choice');
    change('Question 1 options, one per line', 'Sales\nSupport');
    fireEvent.click(screen.getByRole('button', { name: 'Add a rule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a rule' }));
    const [first, second] = screen.getAllByTestId('calendar-routing-rule') as [HTMLElement, HTMLElement];
    fireEvent.click(within(first).getByLabelText('Sales'));
    change('Rule 1 sends the booker to: member', 'bo', first);
    fireEvent.click(within(second).getByLabelText('Sales'));
    fireEvent.click(within(second).getByLabelText('Support'));
    change('Rule 2 sends the booker to: kind', 'team_type', second);
    change('Rule 2 sends the booker to: team type', 'rr', second);
    fireEvent.click(within(second).getByRole('button', { name: 'Move rule 2 up' }));
    change('Anyone else goes to: kind', 'node');
    change('Anyone else goes to: node id', ' n9 ');
    fireEvent.click(screen.getByRole('button', { name: 'Save routing form' }));
    await screen.findByText('Saved Talk to the right person.');

    const { forms } = await readRoutingForms(rig.ports, engine, NODE.id);
    const [form] = forms as [RoutingForm];
    expect(form.rules.map((r) => r.target)).toEqual([{ team_type: { node_id: 'n1', type_id: 'rr' } }, { member: { username: 'bo', slug: 'n1' } }]);
    expect(form.fallback).toEqual({ node: { node_id: 'n9' } });
    const q: string = form.questions[0]?.id ?? '';
    expect(routeAnswers(engine, form, [{ question_id: q, value: 'Sales' }])).toEqual({ team_type: { node_id: 'n1', type_id: 'rr' } });
    expect(routeAnswers(engine, form, [{ question_id: q, value: 'Support' }])).toEqual({ team_type: { node_id: 'n1', type_id: 'rr' } });
  });

  it('is not saved while a target is unchosen, and says which', async () => {
    const rig: { store: MemoryStore; ports: CalendarPorts; } = editor();
    change('Form name', 'Triage');
    fireEvent.click(screen.getByRole('button', { name: 'Save routing form' }));
    await screen.findByText('Some fields need attention.');
    expect(screen.getByText('Choose a member.')).toBeTruthy();
    await waitFor(async () => expect((await readRoutingForms(rig.ports, engine, NODE.id)).forms).toEqual([]));
  });
});
