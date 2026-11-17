/**
 * The Calendar SDK's routes, answered by the member's mounted Calendar (design §3.8). Every
 * decision is the core's (engine.sdk): the gate (an app in another member's session is refused;
 * a change waits for this member's consent), what an added or patched event becomes, and whether
 * an app may change an event. This module reads what the decisions need and does what they say.
 *
 * Consent is asked through `ask`, once per app at a time: two calls racing in from one app share
 * the one prompt. "Allow" and "Refuse" are kept (sdk-store.ts); "Allow once" lets this call
 * through only. Changes run one at a time, so the per-app count the limit reads is never raced,
 * and at most 60 a minute per app are let through.
 */
import type { IhttpMessage } from '@/lib/citadel-apps/glue-sdk/ihttp-io';
import type { IhttpRequest } from '@/lib/citadel-apps/glue-sdk/ihttp-server';
import { announce } from './cal-topic';
import type { CalendarEngine } from './engine/calendar-engine';
import { saveEvent, type SaveOutcome } from './event-save';
import type { Event } from './generated/Event';
import type { Placement } from './generated/Placement';
import type { SdkRefusal } from './generated/SdkRefusal';
import type { SdkRoute } from './generated/SdkRoute';
import type { CalendarPorts } from './ports';
import { REMINDER_PREFIX } from './reminder-scheduler';
import { freeBusy, listEvents } from './sdk-reads';
import { dropPlacement, keepPlacement, keptBy, placementOf, readConsent, saveConsent, whereKept } from './sdk-store';
import type { Consent } from './generated/Consent';
import type { Gate } from './generated/Gate';
import type { SdkAnswer } from './generated/SdkAnswer';
import type { ListQuery } from './generated/ListQuery';
import type { FreeBusyQuery } from './generated/FreeBusyQuery';
import type { NewEvent } from './generated/NewEvent';
import type { EventPatch } from './generated/EventPatch';
import type { Rev } from './generated/Rev';

/** `unanswered`: the prompt went away unanswered; nothing is let through and nothing is kept. */
export type ConsentAnswer = 'allow' | 'once' | 'refuse' | 'unanswered';

export interface SdkHostDeps {
  readonly ports: CalendarPorts;
  readonly engine: CalendarEngine;
  readonly me: string;
  readonly nowMs: () => bigint;
  readonly newId: () => string;
  /** Asks the member whether `appId` may change their calendar. */
  readonly ask: (appId: string) => Promise<ConsentAnswer>;
}

const NO_PROGRESS = (): void => {};

export class SdkHost {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly asking: Map<string, Promise<ConsentAnswer>> = new Map();
  private readonly recent: Map<string, bigint[]> = new Map();

  constructor(private readonly d: SdkHostDeps) {}

  /** Whether `request` is one of the SDK's routes (the rest are the booking routes). */
  owns(request: IhttpRequest): boolean {
    return this.d.engine.sdk.route(request.method, request.path) !== null;
  }

  readonly handle = async (request: IhttpRequest): Promise<IhttpMessage> => {
    const route: SdkRoute | null = this.d.engine.sdk.route(request.method, request.path);
    if (route === null) return this.refuse({ code: 'bad_request', current_rev: null, detail: 'not an SDK route' });
    const app: string = request.caller.app_id;
    const mutates: boolean = route === 'create' || typeof route === 'object';
    const consent: Consent | null = mutates ? await readConsent(this.d.ports, this.d.engine, app) : null;
    const gate: Gate = this.d.engine.sdk.gate(route, request.caller.username, this.d.me, consent);
    if (typeof gate === 'object') return this.refuse(gate.refuse);
    if (gate === 'ask') {
      const answer: ConsentAnswer = await this.askOnce(app);
      if (answer === 'refuse' || answer === 'unanswered') return this.refuse({ code: 'not_consented', current_rev: null, detail: answer === 'refuse' ? 'the member refused this app' : 'the member did not answer' });
    }
    if (!mutates) return this.read(route, request.query);
    return this.serialized(() => this.change(route, app, request.body));
  };

  private askOnce(app: string): Promise<ConsentAnswer> {
    const pending: Promise<ConsentAnswer> | undefined = this.asking.get(app);
    if (pending !== undefined) return pending;
    const asked: Promise<ConsentAnswer> = this.d.ask(app).then(async (answer: ConsentAnswer): Promise<ConsentAnswer> => {
      if (answer === 'allow' || answer === 'refuse') await saveConsent(this.d.ports, this.d.engine, app, answer);
      return answer;
    }).finally((): void => { this.asking.delete(app); });
    this.asking.set(app, asked);
    return asked;
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const turn: Promise<T> = this.queue.then(work);
    this.queue = turn.catch((): void => {});
    return turn;
  }

  private reply(status: number, body: Uint8Array = new Uint8Array()): IhttpMessage {
    return { status, body };
  }

  private refuse(refusal: SdkRefusal): IhttpMessage {
    return this.reply(this.d.engine.sdk.status(refusal), this.d.engine.sdk.encodeRefusal(refusal));
  }

  private async read(route: SdkRoute, query: string): Promise<IhttpMessage> {
    const { ports, engine } = this.d;
    if (route === 'health') return this.reply(200, engine.sdk.encodeHealth(engine.sdk.health()));
    if (route === 'list') {
      const q: SdkAnswer<ListQuery> = engine.sdk.parseListQuery(query);
      if ('refused' in q) return this.refuse(q.refused);
      return this.reply(200, engine.sdk.encodeEvents({ events: await listEvents(ports, engine, q.ok) }));
    }
    const q: SdkAnswer<FreeBusyQuery> = engine.sdk.parseFreeBusyQuery(query);
    if ('refused' in q) return this.refuse(q.refused);
    return this.reply(200, engine.sdk.encodeFreeBusy(await freeBusy(ports, engine, q.ok)));
  }

  /** Within the rate, or the refusal; a change let through counts toward it. */
  private admitted(app: string): boolean {
    const kept: bigint[] | null = this.d.engine.sdk.rateAdmit(this.recent.get(app) ?? [], this.d.nowMs());
    if (kept === null) return false;
    this.recent.set(app, kept);
    return true;
  }

  private decode<T>(body: Uint8Array, decode: (b: Uint8Array) => T): T | null {
    try {
      return decode(body);
    } catch {
      return null;
    }
  }

  private async change(route: SdkRoute, app: string, body: Uint8Array): Promise<IhttpMessage> {
    if (!this.admitted(app)) return this.refuse({ code: 'limit', current_rev: null, detail: '60 changes a minute' });
    const bad = (what: string): IhttpMessage => this.refuse({ code: 'bad_request', current_rev: null, detail: `not ${what}` });
    if (route === 'create') {
      const req: NewEvent | null = this.decode(body, this.d.engine.sdk.decodeNewEvent);
      return req === null ? bad('a new event') : this.create(app, req);
    }
    if (typeof route !== 'object') return bad('a change');
    if ('patch' in route) {
      const patch: EventPatch | null = this.decode(body, this.d.engine.sdk.decodeEventPatch);
      return patch === null ? bad('a patch') : this.update(app, route.patch.id, (e: Event) => this.d.engine.sdk.patchEvent(e, patch, app, this.d.nowMs()));
    }
    const rev: Rev | null = this.decode(body, this.d.engine.sdk.decodeRev);
    return rev === null ? bad('a revision') : this.remove(app, route.delete.id, rev.rev);
  }

  private async create(app: string, req: Parameters<CalendarEngine['sdk']['newEvent']>[0]): Promise<IhttpMessage> {
    const { ports, engine, me } = this.d;
    const adding: { id: string; me: string; app_id: string; kept: number; now_ms: bigint; } = { id: this.d.newId(), me, app_id: app, kept: await keptBy(ports, app), now_ms: this.d.nowMs() };
    const made: SdkAnswer<[Event, Placement]> = engine.sdk.newEvent(req, adding);
    if ('refused' in made) return this.refuse(made.refused);
    const [event, placement] = made.ok;
    await keepPlacement(ports, engine, app, event.id, placement);
    const saved: IhttpMessage | null = await this.save(event, placement, null);
    if (saved !== null) {
      await dropPlacement(ports, app, event.id);
      return saved;
    }
    return this.reply(201, engine.sdk.encodeEventRef({ id: event.id, rev: event.rev }));
  }

  private async stored(app: string, id: string): Promise<{ event: Event; placement: Placement } | null> {
    const placement: Placement | null = await placementOf(this.d.ports, this.d.engine, app, id);
    if (placement === null) return null;
    const { store, key } = whereKept(placement, this.d.me, id);
    const bytes: Uint8Array | null = await this.d.ports.storage.get(store, key);
    return bytes === null ? null : { event: this.d.engine.decodeEvent(bytes), placement };
  }

  private async update(app: string, id: string, patch: (e: Event) => ReturnType<CalendarEngine['sdk']['patchEvent']>): Promise<IhttpMessage> {
    const found: { event: Event; placement: Placement; } | null = await this.stored(app, id);
    if (found === null) return this.refuse({ code: 'not_found', current_rev: null, detail: null });
    const next: SdkAnswer<Event> = patch(found.event);
    if ('refused' in next) return this.refuse(next.refused);
    return (await this.save(next.ok, found.placement, found.event)) ?? this.reply(200, this.d.engine.sdk.encodeRev({ rev: next.ok.rev }));
  }

  private async remove(app: string, id: string, rev: number): Promise<IhttpMessage> {
    const { ports, engine, me } = this.d;
    const found: { event: Event; placement: Placement; } | null = await this.stored(app, id);
    if (found === null) return this.refuse({ code: 'not_found', current_rev: null, detail: null });
    const may: SdkAnswer<null> = engine.sdk.mayChange(found.event, app, rev);
    if ('refused' in may) return this.refuse(may.refused);
    const { store, key } = whereKept(found.placement, me, id);
    await ports.storage.remove(store, key);
    await ports.storage.remove({ kind: 'user' }, `${REMINDER_PREFIX}${id}`);
    await dropPlacement(ports, app, id);
    if (store.kind !== 'user') await announce(ports, engine, { node: found.event.origin_node, key });
    return this.reply(204);
  }

  /** Saves as the editor saves (reminders kept, other windows told); null once saved, else the refusal to answer. */
  private async save(event: Event, placement: Placement, before: Event | null): Promise<IhttpMessage | null> {
    const { store, key } = whereKept(placement, this.d.me, event.id);
    const outcome: SaveOutcome = await saveEvent(this.d.ports, this.d.engine, { ok: true, event, store, key }, before, NO_PROGRESS);
    if (outcome.kind === 'refused') return this.refuse({ code: 'invalid', current_rev: null, detail: outcome.reason });
    return null;
  }
}
