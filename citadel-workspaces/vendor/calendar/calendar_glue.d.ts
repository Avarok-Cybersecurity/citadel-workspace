/* tslint:disable */
/* eslint-disable */

/**
 * The core's zoned questions, bound to the page's offsets.
 */
export class CalendarEngine {
    free(): void;
    [Symbol.dispose](): void;
    civilOf(zone: any, utc_ms: any): any;
    /**
     * The span a round robin's `Equal` counts bookings over for a slot at `atMs`: the calendar
     * month in the type's locked zone (`zoneLock`, or null for UTC).
     */
    equalPeriod(zone_lock: any, at_ms: any): any;
    /**
     * The occurrences of a recurrence, its wall times in `zone`, that overlap `[fromMs, toMs)`.
     */
    expand(recurrence: any, zone: any, from_ms: any, to_ms: any): any;
    freeSlots(request: any): any;
    /**
     * The VEVENTs of an ICS file as drafts, floating times read in `floating`.
     */
    importIcs(text: string, floating: any): any;
    instantOf(zone: any, local: any): any;
    /**
     * `offset_at(zone: string, utcMs: number): number | null`, seconds east of UTC.
     */
    constructor(offset_at: Function);
    /**
     * Whether the request offers `slot`: what a host's instance asks before it claims.
     */
    offers(request: any, slot: any): any;
    resolve(zone: any, local: any): any;
}

export function addDays(date: any, days: number): any;

export function addMonths(date: any, months: number): any;

export function checkPoll(poll: any): void;

export function checkRoutingForm(form: any): void;

export function checkVote(poll: any, vote: any): void;

/**
 * `answers`: `[host, HostAnswer][]` in the order the hosts were asked.
 */
export function collectiveOutcome(answers: any): any;

export function collectiveSlots(per_host: any): any;

export function decodeAvailability(bytes: Uint8Array): any;

export function decodeBooking(bytes: Uint8Array): any;

export function decodeChange(bytes: Uint8Array): any;

export function decodeConsent(bytes: Uint8Array): any;

export function decodeEvent(bytes: Uint8Array): any;

export function decodeEventPatch(bytes: Uint8Array): any;

export function decodeEventRef(bytes: Uint8Array): any;

export function decodeEventType(bytes: Uint8Array): any;

export function decodeEvents(bytes: Uint8Array): any;

export function decodeFreeBusy(bytes: Uint8Array): any;

export function decodeHealth(bytes: Uint8Array): any;

export function decodeNewEvent(bytes: Uint8Array): any;

export function decodePlacement(bytes: Uint8Array): any;

export function decodePoll(bytes: Uint8Array): any;

export function decodePollVote(bytes: Uint8Array): any;

export function decodeProjection(bytes: Uint8Array): any;

export function decodeReminderPlan(bytes: Uint8Array): any;

export function decodeRev(bytes: Uint8Array): any;

export function decodeRoutingForm(bytes: Uint8Array): any;

export function decodeSdkRefusal(bytes: Uint8Array): any;

export function encodeAvailability(value: any): Uint8Array;

export function encodeBooking(value: any): Uint8Array;

/**
 * A `cal` topic message: `{ node, key }` and nothing else.
 */
export function encodeChange(change: any): Uint8Array;

export function encodeConsent(value: any): Uint8Array;

/**
 * An event's stored bytes: versioned CBOR, refused past `EVENT_MAX_BYTES`.
 */
export function encodeEvent(event: any): Uint8Array;

export function encodeEventPatch(value: any): Uint8Array;

export function encodeEventRef(value: any): Uint8Array;

export function encodeEventType(value: any): Uint8Array;

export function encodeEvents(value: any): Uint8Array;

export function encodeFreeBusy(value: any): Uint8Array;

export function encodeHealth(value: any): Uint8Array;

export function encodeNewEvent(value: any): Uint8Array;

export function encodePlacement(value: any): Uint8Array;

export function encodePoll(value: any): Uint8Array;

export function encodePollVote(value: any): Uint8Array;

export function encodeProjection(value: any): Uint8Array;

export function encodeReminderPlan(value: any): Uint8Array;

export function encodeRev(value: any): Uint8Array;

export function encodeRoutingForm(value: any): Uint8Array;

export function encodeSdkRefusal(value: any): Uint8Array;

export function eventPath(id: string): string;

export function exportIcs(events: any): any;

export function fanOutPlan(event: any, subtree: any): any;

export function freeBusyQueryString(query: any): string;

export function listQueryString(query: any): string;

export function mayChangeSdkEvent(event: any, app_id: string, rev: number): any;

export function monthGrid(year: number, month: number): any;

/**
 * `[event, placement]`, or the refusal.
 */
export function newSdkEvent(request: any, adding: any): any;

export function parseFreeBusyQuery(query: string): any;

export function parseListQuery(query: string): any;

export function patchSdkEvent(event: any, patch: any, app_id: string, now_ms: bigint): any;

/**
 * `[picked poll, the slot it picked]`.
 */
export function pickPoll(poll: any, proposal: number, event_id: string): any;

/**
 * What a descendant holds of `event`, by the allow-list; refused for a private event.
 */
export function project(event: any): any;

/**
 * How far a fan-out writes and an up-pull reads.
 */
export function propagationBounds(): any;

/**
 * The free hosts, in the order a booking tries them.
 */
export function rankHosts(strategy: any, hosts: any, free: any, confirmed: any): any;

/**
 * What a reader does with a projection, given what it can read of its origin.
 */
export function reconcile(projection: any, origin: any): any;

/**
 * Where `answers` route on `form`: the first rule that holds, else its fallback.
 */
export function route(form: any, answers: any): any;

/**
 * `consent`: the member's stored answer for the calling app, or null.
 */
export function sdkGate(route: any, caller: string, acting: string, consent: any): any;

export function sdkHealth(): any;

/**
 * An ancestor's event as the page's projection of it holds it.
 */
export function sdkProjectionView(event_id: string, projection: any): any;

/**
 * The instants to keep, this one included, or null when it does not fit.
 */
export function sdkRateAdmit(recent_ms: any, now_ms: bigint): any;

/**
 * The SDK route a request names, or null.
 */
export function sdkRoute(method: any, path: string): any;

export function sdkRoutes(): any;

export function sdkStatus(code: any): number;

/**
 * The app's view of an event, or null for one it is not shown.
 */
export function sdkView(event: any, include: any): any;

export function seatsLeft(seats: number, taken: number): number;

export function shownUpAt(event: any, reader_chain: any): any;

/**
 * `votes`: `[voter, vote][]`. Each proposal with who said yes and maybe.
 */
export function tallyPoll(poll: any, votes: any): any;

export function upPullTargets(descendants: any): any;

export function weekOf(date: any): any;

export function weekdayOf(date: any): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_calendarengine_free: (a: number, b: number) => void;
    readonly addDays: (a: number, b: number, c: number) => void;
    readonly addMonths: (a: number, b: number, c: number) => void;
    readonly calendarengine_civilOf: (a: number, b: number, c: number, d: number) => void;
    readonly calendarengine_equalPeriod: (a: number, b: number, c: number, d: number) => void;
    readonly calendarengine_expand: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly calendarengine_freeSlots: (a: number, b: number, c: number) => void;
    readonly calendarengine_importIcs: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly calendarengine_instantOf: (a: number, b: number, c: number, d: number) => void;
    readonly calendarengine_new: (a: number) => number;
    readonly calendarengine_offers: (a: number, b: number, c: number, d: number) => void;
    readonly calendarengine_resolve: (a: number, b: number, c: number, d: number) => void;
    readonly checkPoll: (a: number, b: number) => void;
    readonly checkRoutingForm: (a: number, b: number) => void;
    readonly checkVote: (a: number, b: number, c: number) => void;
    readonly collectiveOutcome: (a: number, b: number) => void;
    readonly collectiveSlots: (a: number, b: number) => void;
    readonly decodeAvailability: (a: number, b: number, c: number) => void;
    readonly decodeBooking: (a: number, b: number, c: number) => void;
    readonly decodeChange: (a: number, b: number, c: number) => void;
    readonly decodeConsent: (a: number, b: number, c: number) => void;
    readonly decodeEvent: (a: number, b: number, c: number) => void;
    readonly decodeEventPatch: (a: number, b: number, c: number) => void;
    readonly decodeEventRef: (a: number, b: number, c: number) => void;
    readonly decodeEventType: (a: number, b: number, c: number) => void;
    readonly decodeEvents: (a: number, b: number, c: number) => void;
    readonly decodeFreeBusy: (a: number, b: number, c: number) => void;
    readonly decodeHealth: (a: number, b: number, c: number) => void;
    readonly decodeNewEvent: (a: number, b: number, c: number) => void;
    readonly decodePlacement: (a: number, b: number, c: number) => void;
    readonly decodePoll: (a: number, b: number, c: number) => void;
    readonly decodePollVote: (a: number, b: number, c: number) => void;
    readonly decodeProjection: (a: number, b: number, c: number) => void;
    readonly decodeReminderPlan: (a: number, b: number, c: number) => void;
    readonly decodeRev: (a: number, b: number, c: number) => void;
    readonly decodeRoutingForm: (a: number, b: number, c: number) => void;
    readonly decodeSdkRefusal: (a: number, b: number, c: number) => void;
    readonly encodeAvailability: (a: number, b: number) => void;
    readonly encodeBooking: (a: number, b: number) => void;
    readonly encodeChange: (a: number, b: number) => void;
    readonly encodeConsent: (a: number, b: number) => void;
    readonly encodeEvent: (a: number, b: number) => void;
    readonly encodeEventPatch: (a: number, b: number) => void;
    readonly encodeEventRef: (a: number, b: number) => void;
    readonly encodeEventType: (a: number, b: number) => void;
    readonly encodeEvents: (a: number, b: number) => void;
    readonly encodeFreeBusy: (a: number, b: number) => void;
    readonly encodeHealth: (a: number, b: number) => void;
    readonly encodeNewEvent: (a: number, b: number) => void;
    readonly encodePlacement: (a: number, b: number) => void;
    readonly encodePoll: (a: number, b: number) => void;
    readonly encodePollVote: (a: number, b: number) => void;
    readonly encodeProjection: (a: number, b: number) => void;
    readonly encodeReminderPlan: (a: number, b: number) => void;
    readonly encodeRev: (a: number, b: number) => void;
    readonly encodeRoutingForm: (a: number, b: number) => void;
    readonly encodeSdkRefusal: (a: number, b: number) => void;
    readonly eventPath: (a: number, b: number, c: number) => void;
    readonly exportIcs: (a: number, b: number) => void;
    readonly fanOutPlan: (a: number, b: number, c: number) => void;
    readonly freeBusyQueryString: (a: number, b: number) => void;
    readonly listQueryString: (a: number, b: number) => void;
    readonly mayChangeSdkEvent: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly monthGrid: (a: number, b: number, c: number) => void;
    readonly newSdkEvent: (a: number, b: number, c: number) => void;
    readonly parseFreeBusyQuery: (a: number, b: number, c: number) => void;
    readonly parseListQuery: (a: number, b: number, c: number) => void;
    readonly patchSdkEvent: (a: number, b: number, c: number, d: number, e: number, f: bigint) => void;
    readonly pickPoll: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly project: (a: number, b: number) => void;
    readonly propagationBounds: (a: number) => void;
    readonly rankHosts: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly reconcile: (a: number, b: number, c: number) => void;
    readonly route: (a: number, b: number, c: number) => void;
    readonly sdkGate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly sdkHealth: (a: number) => void;
    readonly sdkProjectionView: (a: number, b: number, c: number, d: number) => void;
    readonly sdkRateAdmit: (a: number, b: number, c: bigint) => void;
    readonly sdkRoute: (a: number, b: number, c: number, d: number) => void;
    readonly sdkRoutes: (a: number) => void;
    readonly sdkStatus: (a: number, b: number) => void;
    readonly sdkView: (a: number, b: number, c: number) => void;
    readonly seatsLeft: (a: number, b: number) => number;
    readonly shownUpAt: (a: number, b: number, c: number) => void;
    readonly tallyPoll: (a: number, b: number, c: number) => void;
    readonly upPullTargets: (a: number, b: number) => void;
    readonly weekOf: (a: number, b: number) => void;
    readonly weekdayOf: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
