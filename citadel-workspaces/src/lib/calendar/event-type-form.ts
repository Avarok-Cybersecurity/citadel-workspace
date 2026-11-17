/**
 * What the event-type editor decides (design §3.1, §3.3.2 `EventType`, `BookingRules`): the form's
 * text fields checked into an `EventType`, within the bounds the core's types hold (u8 increment of
 * at least 5 and max per day, u16 buffers, durations and rolling days, u32 notice) and the ones a
 * booker needs to be told about (a choice question with no options cannot be answered).
 */
import type { BookingRules } from './generated/BookingRules';
import type { CivilDate } from './generated/CivilDate';
import type { ColorToken } from './generated/ColorToken';
import type { DateRange } from './generated/DateRange';
import type { EventType } from './generated/EventType';
import type { Question } from './generated/Question';
import type { TypeKind } from './generated/TypeKind';
import { checkKind, kindDraftOf, U16, whole, type KindDraft } from './event-type-kind';

/** `MIN_INCREMENT_MIN` in `slots.rs`. */
export const MIN_INCREMENT_MIN: number = 5;
const U8: number = 255;
const U32: number = 4_294_967_295;

export const COLOR_TOKENS: readonly ColorToken[] = ['primary', 'success', 'warning', 'destructive_emphasis', 'accent', 'secondary'];

export type RangeDraft = { kind: 'rolling'; days: string } | { kind: 'fixed'; from: CivilDate; to: CivilDate } | { kind: 'indefinite' };

export interface EventTypeDraft extends KindDraft {
  name: string;
  /** Comma-separated minutes: "30, 60". */
  durations: string;
  bufferBefore: string;
  bufferAfter: string;
  minNoticeHours: string;
  /** Empty is no limit. */
  maxPerDay: string;
  increment: string;
  range: RangeDraft;
  cancelPolicy: string;
  questions: Question[];
  color: ColorToken;
  /** Null: slots show in the booker's zone. */
  zoneLock: string | null;
}

export type EventTypeCheck = { ok: true; type: EventType } | { ok: false; errors: ReadonlyMap<string, string> };

function rangeOf(draft: RangeDraft, errors: Map<string, string>): DateRange {
  if (draft.kind === 'indefinite') return 'indefinite';
  if (draft.kind === 'fixed') {
    const after: boolean = draft.from.y !== draft.to.y ? draft.from.y > draft.to.y : draft.from.m !== draft.to.m ? draft.from.m > draft.to.m : draft.from.d > draft.to.d;
    if (after) errors.set('range', 'The last date must not be before the first.');
    return { fixed: { from: draft.from, to: draft.to } };
  }
  const days: number | null = whole(draft.days, 1, U16);
  if (days === null) errors.set('range', 'Enter how many days ahead can be booked (1 or more).');
  return { rolling: { days: days ?? 1 } };
}

/** The questions as saved: labels and options trimmed, blank options dropped. */
function checkQuestions(typed: readonly Question[], errors: Map<string, string>): Question[] {
  const ids: Set<string> = new Set();
  const questions: Question[] = typed.map((q: Question): Question => ({
    ...q, label: q.label.trim(), kind: typeof q.kind === 'object' ? { choice: { options: q.kind.choice.options.map((o: string) => o.trim()).filter((o: string) => o !== '') } } : q.kind,
  }));
  questions.forEach((q: Question, i: number): void => {
    if (ids.has(q.id)) throw new Error(`two questions share the id ${q.id}`);
    ids.add(q.id);
    if (q.label === '') errors.set(`question-${i}`, `Question ${i + 1} needs a label.`);
    else if (typeof q.kind === 'object' && q.kind.choice.options.length < 2) errors.set(`question-${i}`, `${q.label}: a choice needs at least two options.`);
    else if (typeof q.kind === 'object' && new Set(q.kind.choice.options).size !== q.kind.choice.options.length) errors.set(`question-${i}`, `${q.label}: each option once.`);
  });
  return questions;
}

/** Error keys: name, seats, hosts, weights, durations, bufferBefore, bufferAfter, minNotice, maxPerDay, increment, range, question-<i>, zoneLock. */
export function checkEventType(id: string, draft: EventTypeDraft, knownZone: (zone: string) => boolean): EventTypeCheck {
  const errors: Map<string, string> = new Map();
  if (draft.name.trim() === '') errors.set('name', 'Give the event type a name.');
  const kind: TypeKind = checkKind(draft, errors);
  const durations: (number | null)[] = draft.durations.split(',').filter((d: string) => d.trim() !== '').map((d: string) => whole(d, 5, U16));
  if (durations.length === 0 || durations.some((d) => d === null)) errors.set('durations', 'List one or more lengths in minutes, 5 or more, separated by commas.');
  const field = (key: string, text: string, min: number, max: number, message: string): number => {
    const n: number | null = whole(text, min, max);
    if (n === null) errors.set(key, message);
    return n ?? min;
  };
  const noticeHours: number = field('minNotice', draft.minNoticeHours, 0, Math.floor(U32 / 60), 'Enter the minimum notice in whole hours.');
  const rules: BookingRules = {
    buffer_before_min: field('bufferBefore', draft.bufferBefore, 0, U16, 'Enter the buffer before in whole minutes.'),
    buffer_after_min: field('bufferAfter', draft.bufferAfter, 0, U16, 'Enter the buffer after in whole minutes.'),
    min_notice_min: noticeHours * 60,
    max_per_day: draft.maxPerDay.trim() === '' ? null : field('maxPerDay', draft.maxPerDay, 1, U8, 'Enter a limit from 1 to 255, or leave it empty.'),
    increment_min: field('increment', draft.increment, MIN_INCREMENT_MIN, U8, `Slots start every ${MIN_INCREMENT_MIN} to ${U8} minutes.`),
    range: rangeOf(draft.range, errors),
    cancel_policy: draft.cancelPolicy.trim() === '' ? null : draft.cancelPolicy.trim(),
  };
  const questions: Question[] = checkQuestions(draft.questions, errors);
  if (draft.zoneLock !== null && !knownZone(draft.zoneLock)) errors.set('zoneLock', `${draft.zoneLock} is not a time zone this browser knows.`);
  if (errors.size > 0) return { ok: false, errors };
  const lengths: number[] = [...new Set(durations as number[])].sort((a: number, b: number) => a - b);
  return {
    ok: true,
    type: { id, name: draft.name.trim(), kind, durations_min: lengths, rules, questions, color: draft.color, locked: false, zone_lock: draft.zoneLock },
  };
}

/** The form for an existing type, of any kind. */
export function eventTypeDraft(type: EventType): EventTypeDraft {
  const r: BookingRules = type.rules;
  const range: RangeDraft = r.range === 'indefinite' ? { kind: 'indefinite' } : 'fixed' in r.range ? { kind: 'fixed', ...r.range.fixed } : { kind: 'rolling', days: String(r.range.rolling.days) };
  return {
    ...kindDraftOf(type.kind),
    name: type.name,
    durations: type.durations_min.join(', '),
    bufferBefore: String(r.buffer_before_min),
    bufferAfter: String(r.buffer_after_min),
    minNoticeHours: String(Math.ceil(r.min_notice_min / 60)),
    maxPerDay: r.max_per_day === null ? '' : String(r.max_per_day),
    increment: String(r.increment_min),
    range,
    cancelPolicy: r.cancel_policy ?? '',
    questions: type.questions,
    color: type.color,
    zoneLock: type.zone_lock,
  };
}
