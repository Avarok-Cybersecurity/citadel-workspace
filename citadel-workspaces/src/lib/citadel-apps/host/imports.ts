/**
 * The import object an app module is instantiated with, and nothing else: the memory the host
 * made, the two reply readers, and one function per ABI group. A group the grant does not open is
 * still present (the module instantiates and can degrade) but every call to it answers
 * `{refused: "ungranted"}` without reaching the dispatcher. Before either, the lifecycle gate: a
 * closing instance reaches only `storage` and `log`, a closed one nothing (lifecycle.ts), and the
 * refusal is the same whether the group was granted or not.
 *
 * Pure: the grant, the memory and the call sink go in, the object comes out. No function here
 * throws into the guest: a pointer outside memory is ABI_ERROR.BAD_REQUEST, anything else is a reply.
 */
import { ABI_ERROR, ABI_GROUPS, ABI_NAMESPACE, MEMORY_IMPORT, REPLY_LEN, REPLY_READ, type AbiGroup } from './abi';
import { encodeCbor } from './cbor';
import { CAPABILITY_GROUP, effectiveGrant, type Capability } from './capabilities';
import type { DispatchOutcome } from './dispatch';
import type { Refused } from './ports';
import { inBounds, type ReplyTable } from './reply-table';

export interface CallSink {
  readonly call: (group: AbiGroup, op: number, request: Uint8Array) => DispatchOutcome;
  readonly replies: ReplyTable;
  /** A pending reply is ready: the host tells the guest with AppEvent `{reply_ready: {handle}}`. */
  readonly replyReady: (handle: number) => void;
  /** The lifecycle's answer to a call to `group` before anything else (lifecycle.ts), or null. */
  readonly gate: (group: AbiGroup) => Refused | null;
}

const UNGRANTED: Uint8Array = encodeCbor({ refused: 'ungranted' });

/** The groups at least one capability in the effective grant opens. */
export function grantedGroups(granted: ReadonlySet<Capability>): ReadonlySet<AbiGroup> {
  return new Set<AbiGroup>([...effectiveGrant(granted)].map((c: Capability) => CAPABILITY_GROUP[c]));
}

type GroupFn = (op: number, ptr: number, len: number) => number;

function refusingStub(group: AbiGroup, sink: CallSink): GroupFn {
  return (): number => {
    const gated: Refused | null = sink.gate(group);
    return sink.replies.ready(gated === null ? UNGRANTED : encodeCbor({ refused: gated }));
  };
}

function liveGroup(group: AbiGroup, memory: WebAssembly.Memory, sink: CallSink): GroupFn {
  return (op: number, ptr: number, len: number): number => {
    try {
      const gated: Refused | null = sink.gate(group);
      if (gated !== null) return sink.replies.ready(encodeCbor({ refused: gated }));
      const p: number = ptr >>> 0;
      const n: number = len >>> 0;
      if (!inBounds(memory, p, n)) return ABI_ERROR.BAD_REQUEST;
      const request: Uint8Array = new Uint8Array(memory.buffer, p, n).slice();
      const outcome: DispatchOutcome = sink.call(group, op, request);
      if ('now' in outcome) return sink.replies.ready(outcome.now);
      const handle: number = sink.replies.pending();
      if (handle < 0) return handle;
      void outcome.later.then((bytes: Uint8Array): void => {
        if (sink.replies.resolve(handle, bytes)) sink.replyReady(handle);
      });
      return handle;
    } catch {
      return ABI_ERROR.BAD_REQUEST;
    }
  };
}

export function buildImports(granted: ReadonlySet<Capability>, memory: WebAssembly.Memory, sink: CallSink): WebAssembly.Imports {
  const open: ReadonlySet<AbiGroup> = grantedGroups(granted);
  const ns: Record<string, WebAssembly.ImportValue> = {
    [MEMORY_IMPORT]: memory,
    [REPLY_READ]: (handle: number, ptr: number, cap: number): number => {
      try {
        return sink.replies.read(handle, memory, ptr >>> 0, cap >>> 0);
      } catch {
        return ABI_ERROR.BAD_REQUEST;
      }
    },
    [REPLY_LEN]: (handle: number): number => {
      try {
        return sink.replies.length(handle);
      } catch {
        return ABI_ERROR.BAD_REQUEST;
      }
    },
  };
  for (const group of ABI_GROUPS) ns[group] = open.has(group) ? liveGroup(group, memory, sink) : refusingStub(group, sink);
  return { [ABI_NAMESPACE]: ns };
}
