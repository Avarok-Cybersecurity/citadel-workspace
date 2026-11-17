/**
 * The page's planes, shared by every instance of an install on it (E9, S5). Two zones of one
 * install on one page are two instances with one session: each hears every frame for the
 * install and every topic message, so without this both served one request (the sibling then
 * Cancelled it as unknown), their calls' stream ids collided, and the first to close left the
 * topic group for both.
 *
 * - **Heads:** exactly one instance takes inbound RequestHeads, the primary: the earliest still
 *   attached. When it closes, the next one is primary.
 * - **Other frames:** a frame goes to the instance whose stream it is; one no instance holds goes
 *   to the primary, whose router answers it. Whether a frame is on a served stream or a call is
 *   the plane's to say (the relay's served ids carry RELAY_STREAM_BIT; the P2P port admitted
 *   its own), never guessed from the id, which a served stream and a call may share.
 * - **Call ids:** each instance's SDK numbers its calls from 1, so a call goes out under a page id
 *   unique to the install and rising, and its answers come back under the instance's own id. A
 *   lone instance's ids go out as they are.
 * - **Topics:** each topic is held once per install per page; the group is left when the last
 *   holder lets go, and one holder answers join requests.
 * - **Unknown apps:** a P2P head for an app no instance here runs is refused once, by the page's
 *   first seat, exactly as an unauthorised one is (S10).
 *
 * Pure: no I/O, and nothing here sends anything.
 */
import type { Caller } from '../sdk/generated/Caller';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import { RELAY_STREAM_BIT } from '../host/ihttp-wire';

/** Who sent a frame, as its session vouches: enough to name the stream it belongs to. */
export type FrameSender = Pick<Caller, 'cid' | 'install_id' | 'app_id' | 'via'>;

interface Call { readonly seat: number; readonly local: bigint }

interface TopicHold {
  readonly holders: number[];
  readonly group: Promise<string | null>;
}

interface Install {
  readonly appId: string;
  readonly seats: number[];
  /** Served stream → the seat whose primary took its head. */
  readonly served: Map<string, number>;
  /** `${app}#${page id}` → the call, and `${seat}|${app}#${local id}` → its page id. */
  readonly calls: Map<string, Call>;
  readonly pageIds: Map<string, bigint>;
  nextId: bigint;
  readonly topics: Map<string, TopicHold>;
  /** Leaves of a topic still in flight: a new hold waits for them. */
  readonly leaving: Map<string, Set<Promise<unknown>>>;
}

const servedKey = (s: FrameSender, stream: bigint): string => `${s.cid.toString()}/${s.install_id}/${s.via}#${stream.toString()}`;
const callKey = (appId: string, id: bigint): string => `${appId}#${id.toString()}`;
const isHead = (f: IhttpFrame): boolean => typeof f.kind === 'object' && 'RequestHead' in f.kind;
const ends = (f: IhttpFrame): boolean => f.kind === 'End' || (typeof f.kind === 'object' && 'Cancel' in f.kind);
const withStream = (f: IhttpFrame, stream: bigint): IhttpFrame => ({ ...f, stream });

/** One instance's place on the page. */
export interface PlaneSeat {
  /** Whether this instance takes inbound RequestHeads: it is the install's primary. */
  readonly primary: () => boolean;
  /** Whether this instance takes a relayed frame on a stream it serves (the relay's ids carry RELAY_STREAM_BIT). */
  readonly takesServed: (from: FrameSender, f: IhttpFrame) => boolean;
  /** This instance has a P2P plane, so it may answer for apps nobody here runs. */
  readonly hasP2p: () => void;
  /** A P2P head for `appId`, which this install is not: whether this seat answers it, as refused. */
  readonly answersForeign: (appId: string) => boolean;
  /** The app's call frame, under its page id. */
  readonly callOut: (appId: string, f: IhttpFrame) => IhttpFrame;
  /** A frame answering a call to `appId`: under the app's own id when the call is this instance's, as it is for the primary when it is nobody's (its router answers it), else null. */
  readonly callIn: (appId: string, f: IhttpFrame) => IhttpFrame | null;
  /** The app ended a stream it serves. */
  readonly servedEnded: (peer: FrameSender, stream: bigint) => void;
  /** The topic's group, opened by `open` only for its first holder on the page. */
  readonly holdTopic: (name: string, open: () => Promise<string | null>) => Promise<string | null>;
  /** Lets go of the topic; the group id when this was its last holder (the caller leaves it), else null. */
  readonly releaseTopic: (name: string) => string | null;
  /** Records a leave in flight, which the next hold of the topic waits for. */
  readonly leaving: (name: string, left: Promise<unknown>) => void;
  /** Whether this instance answers the topic's join requests. */
  readonly answersJoins: (name: string) => boolean;
  readonly detach: () => void;
}

export class InstallPlaneRegistry {
  private readonly installs: Map<string, Install> = new Map<string, Install>();
  /** The seats with a P2P plane, in the order they gained it: the first answers for apps nobody here runs. */
  private readonly p2p: number[] = [];
  private seatCount: number = 0;
  /** Group ids settle asynchronously: a hold's resolved id, kept so a release can name it. */
  private readonly groupOf: Map<Promise<string | null>, string | null> = new Map<Promise<string | null>, string | null>();

  attach(installId: string, appId: string): PlaneSeat {
    const me: number = ++this.seatCount;
    const inst: Install = this.installs.get(installId) ?? {
      appId, seats: [], served: new Map(), calls: new Map(), pageIds: new Map(), nextId: 0n, topics: new Map(), leaving: new Map(),
    };
    this.installs.set(installId, inst);
    inst.seats.push(me);
    const primary = (): boolean => inst.seats[0] === me;
    return {
      primary,
      takesServed: (from, f) => this.takesServed(inst, me, primary(), from, f),
      hasP2p: (): void => { if (!this.p2p.includes(me)) this.p2p.push(me); },
      answersForeign: (other) => this.p2p[0] === me && ![...this.installs.values()].some((i: Install) => i.appId === other),
      callOut: (target, f) => this.callOut(inst, me, target, f),
      callIn: (target, f) => this.callIn(inst, me, primary(), target, f),
      servedEnded: (peer, stream): void => { if (inst.served.get(servedKey(peer, stream)) === me) inst.served.delete(servedKey(peer, stream)); },
      holdTopic: (name, open) => this.holdTopic(inst, me, name, open),
      releaseTopic: (name) => this.releaseTopic(inst, me, name),
      leaving: (name, left) => this.noteLeave(inst, name, left),
      answersJoins: (name) => inst.topics.get(name)?.holders[0] === me,
      detach: () => this.detach(installId, inst, me),
    };
  }

  private takesServed(inst: Install, me: number, primary: boolean, from: FrameSender, f: IhttpFrame): boolean {
    const served: string = servedKey(from, f.stream);
    if (isHead(f)) {
      if (primary && !inst.served.has(served)) inst.served.set(served, me);
      return primary;
    }
    const owner: number | undefined = inst.served.get(served);
    // The caller's End leaves the response to come; only its Cancel ends the stream here.
    if (owner !== undefined && typeof f.kind === 'object' && 'Cancel' in f.kind) inst.served.delete(served);
    return owner === undefined ? primary : owner === me;
  }

  private callOut(inst: Install, me: number, appId: string, f: IhttpFrame): IhttpFrame {
    const mine: string = `${me}|${callKey(appId, f.stream)}`;
    let page: bigint | undefined = inst.pageIds.get(mine);
    if (page === undefined) {
      if (!isHead(f)) return f;
      // The app's own id while it is past every id the install sent, so a lone instance's ids go out unchanged.
      inst.nextId = f.stream > inst.nextId ? f.stream : inst.nextId + 1n;
      page = inst.nextId & ~RELAY_STREAM_BIT;
      inst.pageIds.set(mine, page);
      inst.calls.set(callKey(appId, page), { seat: me, local: f.stream });
    }
    if (typeof f.kind === 'object' && 'Cancel' in f.kind) this.forgetCall(inst, mine, appId, page);
    return withStream(f, page);
  }

  private callIn(inst: Install, me: number, primary: boolean, appId: string, f: IhttpFrame): IhttpFrame | null {
    const call: Call | undefined = inst.calls.get(callKey(appId, f.stream));
    if (call === undefined) return primary ? f : null;
    if (call.seat !== me) return null;
    if (ends(f)) this.forgetCall(inst, `${me}|${callKey(appId, call.local)}`, appId, f.stream);
    return withStream(f, call.local);
  }

  private forgetCall(inst: Install, mine: string, appId: string, page: bigint): void {
    inst.pageIds.delete(mine);
    inst.calls.delete(callKey(appId, page));
  }

  private async holdTopic(inst: Install, me: number, name: string, open: () => Promise<string | null>): Promise<string | null> {
    const held: TopicHold | undefined = inst.topics.get(name);
    if (held !== undefined) {
      held.holders.push(me);
      const id: string | null = await held.group;
      if (id === null) this.releaseTopic(inst, me, name);
      return id;
    }
    const pending: Promise<unknown>[] = [...(inst.leaving.get(name) ?? [])];
    const group: Promise<string | null> = Promise.all(pending).then(open);
    inst.topics.set(name, { holders: [me], group });
    const id: string | null = await group;
    this.groupOf.set(group, id);
    if (id === null) this.releaseTopic(inst, me, name);
    return id;
  }

  private releaseTopic(inst: Install, me: number, name: string): string | null {
    const held: TopicHold | undefined = inst.topics.get(name);
    if (held === undefined || !held.holders.includes(me)) return null;
    held.holders.splice(held.holders.indexOf(me), 1);
    if (held.holders.length > 0) return null;
    inst.topics.delete(name);
    const id: string | null = this.groupOf.get(held.group) ?? null;
    this.groupOf.delete(held.group);
    return id;
  }

  private noteLeave(inst: Install, name: string, left: Promise<unknown>): void {
    const set: Set<Promise<unknown>> = inst.leaving.get(name) ?? new Set<Promise<unknown>>();
    inst.leaving.set(name, set);
    set.add(left);
    const drop = (): void => { set.delete(left); };
    void left.then(drop, drop);
  }

  private detach(installId: string, inst: Install, me: number): void {
    const drop = (list: number[]): void => { if (list.includes(me)) list.splice(list.indexOf(me), 1); };
    drop(inst.seats);
    drop(this.p2p);
    for (const [k, seat] of [...inst.served]) if (seat === me) inst.served.delete(k);
    for (const [k, call] of [...inst.calls]) if (call.seat === me) inst.calls.delete(k);
    for (const k of [...inst.pageIds.keys()]) if (k.startsWith(`${me}|`)) inst.pageIds.delete(k);
    if (inst.seats.length === 0 && inst.topics.size === 0) this.installs.delete(installId);
  }
}
