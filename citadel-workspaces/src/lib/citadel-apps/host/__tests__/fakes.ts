/**
 * TEST FAKES for the injected ports and the clock: the only stand-ins these tests use. Each fake
 * records the op and arguments it was called with and answers what the test configured.
 */
import type { NodeInfo } from '../../sdk/generated/NodeInfo';
import type { DispatchClock } from '../dispatch';
import type { OpName } from '../op-args';
import type { HostNetPort, IhttpPort, LogPort, NodesPort, PortAnswer, PortReply, StoragePort, UiPort } from '../ports';

export interface Recorder {
  readonly calls: { readonly method: OpName; readonly args: unknown }[];
}

/** A handler for op `method` that records its arguments and answers `answer()`. */
export function recordingCall<A, R>(rec: Recorder, method: OpName, answer: () => PortReply<R>): (args: A) => PortReply<R> {
  return (args: A): PortReply<R> => {
    rec.calls.push({ method, args });
    return answer();
  };
}

const okLater = <T>(value: T) => (): Promise<PortAnswer<T>> => Promise.resolve({ ok: value });
const okNow = <T>(value: T) => (): PortAnswer<T> => ({ ok: value });

const node: NodeInfo = { node_id: 'n1', parent_id: null, name: 'Board', has_children: false };

export function fakeNodes(rec: Recorder): NodesPort {
  return {
    NodeGet: recordingCall(rec, 'NodeGet', okLater(node)),
    NodeChildren: recordingCall(rec, 'NodeChildren', okLater({ nodes: [] })),
    NodeReadMdx: recordingCall(rec, 'NodeReadMdx', okLater({ text: '' })),
    NodeCreate: recordingCall(rec, 'NodeCreate', okLater({ ...node, node_id: 'n2' })),
    NodeRename: recordingCall(rec, 'NodeRename', okLater(null)),
    NodeMove: recordingCall(rec, 'NodeMove', okLater(null)),
  };
}

export function fakeStorage(rec: Recorder): StoragePort {
  return {
    KvGet: recordingCall(rec, 'KvGet', okLater({ value: null })),
    KvSet: recordingCall(rec, 'KvSet', okLater(null)),
    KvSetMany: recordingCall(rec, 'KvSetMany', okLater(null)),
    KvDelete: recordingCall(rec, 'KvDelete', okLater(null)),
    KvList: recordingCall(rec, 'KvList', okLater({ keys: [], next: null })),
    KvListAuthored: recordingCall(rec, 'KvListAuthored', okLater({ entries: [], next: null })),
  };
}

export function fakeUi(rec: Recorder): UiPort {
  return {
    SetToolbar: recordingCall(rec, 'SetToolbar', okNow(null)),
    OpenMenu: recordingCall(rec, 'OpenMenu', okNow(null)),
    ShowDialog: recordingCall(rec, 'ShowDialog', okNow(null)),
    ShowToast: recordingCall(rec, 'ShowToast', okNow(null)),
    RequestHeight: recordingCall(rec, 'RequestHeight', okNow({ px: 0 })),
  };
}

export function fakeLog(rec: Recorder): LogPort {
  return { LogWrite: recordingCall(rec, 'LogWrite', okNow(null)) };
}

/** The agent's AppFetch, streaming included: one open stream that yields one chunk then ends. */
export function fakeHostNet(rec: Recorder): HostNetPort {
  return {
    HostFetch: recordingCall(rec, 'HostFetch', okLater({ status: 200, headers: [], body: new Uint8Array([1]) })),
    HostFetchOpen: recordingCall(rec, 'HostFetchOpen', okLater({ stream: 7, status: 200, headers: [] })),
    NetStreamRead: recordingCall(rec, 'NetStreamRead', okLater({ bytes: new Uint8Array([2]), end: true })),
    NetStreamClose: recordingCall(rec, 'NetStreamClose', okNow(null)),
  };
}

/** The ihttp transport; `respond` records the frames the router let out. */
export function fakeIhttp(rec: Recorder, frames: Parameters<IhttpPort['respond']>[] = []): IhttpPort {
  return {
    IhttpServe: recordingCall(rec, 'IhttpServe', okLater(null)),
    IhttpCall: recordingCall(rec, 'IhttpCall', okLater(null)),
    respond: (peer, frame): PortAnswer<null> => {
      frames.push([peer, frame]);
      return { ok: null };
    },
    onFrame: () => () => {},
  };
}

/** A clock the test advances by hand; timers fire in `advance`. */
export class ManualClock implements DispatchClock {
  private timers: { at: number; fire: () => void; live: boolean }[] = [];

  /** `t`: where it starts. 0 for tests that only measure elapsed time; a page's tests start it at their pinned instant. */
  constructor(private t: number = 0) {}

  readonly now = (): number => this.t;

  readonly after = (ms: number, fire: () => void): (() => void) => {
    const timer: { at: number; fire: () => void; live: boolean } = { at: this.t + ms, fire, live: true };
    this.timers.push(timer);
    return (): void => {
      timer.live = false;
    };
  };

  advance(ms: number): void {
    this.t += ms;
    const due: { at: number; fire: () => void; live: boolean }[] = this.timers.filter((x) => x.live && x.at <= this.t);
    this.timers = this.timers.filter((x) => !due.includes(x));
    for (const x of due) x.fire();
  }
}
