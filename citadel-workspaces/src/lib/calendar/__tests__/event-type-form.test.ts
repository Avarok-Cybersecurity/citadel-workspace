/**
 * The event-type editor's checks: every rule within the bounds the core's types hold, a group
 * seating two or more, a choice question with options to choose from; and a saved type
 * round-trips through its form.
 */
import { describe, expect, it } from 'vitest';
import { checkEventType, eventTypeDraft, type EventTypeDraft } from '../event-type-form';
import { NY } from './engine-rig';
import { INTRO } from './booking-fixture';
import type { EventType } from '../generated/EventType';
import type { EventTypeCheck } from '@/lib/calendar/event-type-form';

const known = (zone: string): boolean => zone === NY;
const draft: EventTypeDraft = eventTypeDraft(INTRO);
const errorsOf = (d: Partial<EventTypeDraft>): string[] => {
  const checked: EventTypeCheck = checkEventType('t1', { ...draft, ...d }, known);
  return checked.ok ? [] : [...checked.errors.keys()].sort();
};

describe('the event-type editor', () => {
  it('round-trips a saved type through its form', () => {
    expect(checkEventType('t1', draft, known)).toEqual({ ok: true, type: INTRO });
  });

  it('sorts and dedupes the lengths, and refuses one under five minutes or not a number', () => {
    const checked: EventTypeCheck = checkEventType('t1', { ...draft, durations: '60, 30,60' }, known);
    expect(checked.ok && checked.type.durations_min).toEqual([30, 60]);
    expect(errorsOf({ durations: '3' })).toEqual(['durations']);
    expect(errorsOf({ durations: '30, half an hour' })).toEqual(['durations']);
    expect(errorsOf({ durations: '' })).toEqual(['durations']);
  });

  it("holds each rule to the core's bounds", () => {
    expect(errorsOf({ increment: '4' })).toEqual(['increment']);
    expect(errorsOf({ increment: '256' })).toEqual(['increment']);
    expect(errorsOf({ maxPerDay: '0' })).toEqual(['maxPerDay']);
    expect(errorsOf({ bufferBefore: '-5' })).toEqual(['bufferBefore']);
    expect(errorsOf({ bufferAfter: '65536' })).toEqual(['bufferAfter']);
    expect(errorsOf({ minNoticeHours: '1.5' })).toEqual(['minNotice']);
    expect(errorsOf({ range: { kind: 'rolling', days: '0' } })).toEqual(['range']);
    expect(errorsOf({ range: { kind: 'fixed', from: { y: 2024, m: 7, d: 2 }, to: { y: 2024, m: 7, d: 1 } } })).toEqual(['range']);
    expect(errorsOf({ maxPerDay: '' })).toEqual([]);
  });

  it('seats a group at two or more and keeps the notice in minutes', () => {
    expect(errorsOf({ kind: 'group', seats: '1' })).toEqual(['seats']);
    const group: EventTypeCheck = checkEventType('t1', { ...draft, kind: 'group', seats: '12', minNoticeHours: '24' }, known);
    expect(group.ok && group.type.kind).toEqual({ group: { seats: 12 } });
    expect(group.ok && group.type.rules.min_notice_min).toBe(24 * 60);
  });

  it('refuses a blank name, a question without a label, a choice with one option, and an unknown locked zone', () => {
    const questions: ({ id: string; label: string; kind: "text"; required: boolean; } | { id: string; label: string; kind: { choice: { options: string[]; }; }; required: boolean; })[] = [{ id: 'a', label: '', kind: 'text' as const, required: false }, { id: 'b', label: 'Pick', kind: { choice: { options: ['Only', ' '] } }, required: true }];
    expect(errorsOf({ name: '  ', questions, zoneLock: 'Mars/Olympus' })).toEqual(['name', 'question-0', 'question-1', 'zoneLock']);
  });

  it.each<EventType['kind']>([
    'poll',
    { collective: { hosts: ['ana', 'bo', 'cy'] } },
    { round_robin: { hosts: ['ana', 'bo'], strategy: 'equal' } },
    { round_robin: { hosts: ['bo', 'ana'], strategy: 'availability' } },
    { round_robin: { hosts: ['ana', 'bo'], strategy: { priority: { weights: [['ana', 3], ['bo', 1]] } } } },
  ])('round-trips every kind the core has through its form: %j', (kind) => {
    const type: EventType = { ...INTRO, kind };
    expect(checkEventType('t1', eventTypeDraft(type), known)).toEqual({ ok: true, type });
  });

  it('holds a team to two hosts or more, a collective to eight, and a priority to a weight per host', () => {
    expect(errorsOf({ kind: 'round_robin', hosts: ['ana'] })).toEqual(['hosts']);
    expect(errorsOf({ kind: 'collective', hosts: ['ana', 'ana'] })).toEqual(['hosts']);
    expect(errorsOf({ kind: 'collective', hosts: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] })).toEqual(['hosts']);
    expect(errorsOf({ kind: 'collective', hosts: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })).toEqual([]);
    expect(errorsOf({ kind: 'round_robin', hosts: ['ana', 'bo'], strategy: 'priority', weights: { ana: '2' } })).toEqual(['weights']);
    expect(errorsOf({ kind: 'round_robin', hosts: ['ana', 'bo'], strategy: 'priority', weights: { ana: '2', bo: '0' } })).toEqual(['weights']);
  });

  it('keeps a weight only for a host the type still names', () => {
    const checked: EventTypeCheck = checkEventType('t1', { ...draft, kind: 'round_robin', hosts: ['ana', 'bo'], strategy: 'priority', weights: { ana: '2', bo: '5', cy: '9' } }, known);
    expect(checked.ok && checked.type.kind).toEqual({ round_robin: { hosts: ['ana', 'bo'], strategy: { priority: { weights: [['ana', 2], ['bo', 5]] } } } });
  });
});
