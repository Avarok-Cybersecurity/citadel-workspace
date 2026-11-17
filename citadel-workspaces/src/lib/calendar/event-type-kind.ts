/**
 * Who books an event type's slot, the part of the event-type editor that differs by kind (design
 * §3.1, §3.6.2, §3.6.3): one person, a group up to a number of seats, or a poll of times the host
 * proposes, all a member's own; or one of a team's hosts (round robin, chosen by a strategy) or all
 * of them at once (collective), which are the node's. Checked within the core's bounds: a u16 seat
 * count and weight, and a collective of at most `MAX_COLLECTIVE_HOSTS`.
 */
import type { Strategy } from './generated/Strategy';
import type { TypeKind } from './generated/TypeKind';

/** `MAX_COLLECTIVE_HOSTS` in the core's team.rs: the most hosts one claim fans out to. */
export const MAX_COLLECTIVE_HOSTS: number = 8;
/** The largest u16, the core's bound on seats, weights, buffers and lengths. */
export const U16: number = 65_535;

export type EditableKind = 'one_on_one' | 'group' | 'poll' | 'round_robin' | 'collective';
export type StrategyName = 'equal' | 'priority' | 'availability';

/** The kinds one editor offers, never none. */
export type KindChoice = readonly [EditableKind, ...EditableKind[]];
/** A member's own kinds, offered on their booking page; a poll is voted on, never booked as a slot. */
export const OWN_KINDS: KindChoice = ['one_on_one', 'group', 'poll'];
/** A team's kinds, kept on the node by its editors. */
export const TEAM_KINDS: KindChoice = ['round_robin', 'collective'];

export const isTeamKind = (kind: EditableKind): boolean => TEAM_KINDS.includes(kind);

export interface KindDraft {
  kind: EditableKind;
  seats: string;
  /** A team type's hosts, in the order the editor lists them. */
  hosts: readonly string[];
  strategy: StrategyName;
  /** Per host, for `priority`: a whole number, the highest tried first. */
  weights: Readonly<Record<string, string>>;
}

/** `text` as a whole number within `min..=max`, or null. */
export function whole(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n: number = Number(text.trim());
  return n >= min && n <= max ? n : null;
}

function strategyOf(draft: KindDraft, errors: Map<string, string>): Strategy {
  if (draft.strategy !== 'priority') return draft.strategy;
  const weights: [string, number][] = draft.hosts.map((host: string): [string, number] => {
    const w: number | null = whole(draft.weights[host] ?? '', 1, U16);
    if (w === null) errors.set('weights', `Give each host a weight from 1 to ${U16}; ${host} has none.`);
    return [host, w ?? 1];
  });
  return { priority: { weights } };
}

/** Error keys: seats, hosts, weights. */
export function checkKind(draft: KindDraft, errors: Map<string, string>): TypeKind {
  if (draft.kind === 'one_on_one' || draft.kind === 'poll') return draft.kind;
  if (draft.kind === 'group') {
    const seats: number | null = whole(draft.seats, 2, U16);
    if (seats === null) errors.set('seats', 'A group event seats 2 or more.');
    return { group: { seats: seats ?? 2 } };
  }
  const hosts: string[] = [...new Set(draft.hosts)];
  if (hosts.length < 2) errors.set('hosts', 'Choose at least two hosts.');
  if (draft.kind === 'collective') {
    if (hosts.length > MAX_COLLECTIVE_HOSTS) errors.set('hosts', `A collective has at most ${MAX_COLLECTIVE_HOSTS} hosts, all free at once.`);
    return { collective: { hosts } };
  }
  return { round_robin: { hosts, strategy: strategyOf({ ...draft, hosts }, errors) } };
}

/** The kind fields of a saved type's form; every kind the core has is one this editor makes. */
export function kindDraftOf(kind: TypeKind): KindDraft {
  const none: { seats: string; hosts: never[]; strategy: "equal"; weights: {}; } = { seats: '', hosts: [], strategy: 'equal' as const, weights: {} };
  if (kind === 'one_on_one' || kind === 'poll') return { ...none, kind };
  if ('group' in kind) return { ...none, kind: 'group', seats: String(kind.group.seats) };
  if ('collective' in kind) return { ...none, kind: 'collective', hosts: kind.collective.hosts };
  const s: Strategy = kind.round_robin.strategy;
  const weights: Record<string, string> = typeof s === 'object' ? Object.fromEntries(s.priority.weights.map(([h, w]) => [h, String(w)])) : {};
  return { ...none, kind: 'round_robin', hosts: kind.round_robin.hosts, strategy: typeof s === 'object' ? 'priority' : s, weights };
}
