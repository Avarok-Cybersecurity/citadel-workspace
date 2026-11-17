/**
 * Invokers: how an op reaches its port. `directInvoker` calls the injected port in this realm
 * (the main thread, or the worker for its own canvas). `regrantedCall` is the main thread's
 * re-check of calls arriving from a worker: it looks the op up in the same table, re-checks its arguments and
 * refuses one the grant does not cover, so a confused worker still cannot reach an ungranted port.
 */
import type { AbiGroup } from './abi';
import type { CborMap } from './cbor';
import { effectiveGrant, type Capability } from './capabilities';
import type { PortInvoker } from './dispatch';
import { parseArgs } from './op-args';
import { findOp, invokePort, type OpEntry } from './ops';
import type { HostPorts, PortReply } from './ports';

export function directInvoker(ports: HostPorts): PortInvoker {
  return { invoke: (entry: OpEntry, args: CborMap): PortReply | undefined => invokePort(ports, entry, args) };
}

/** Local ports answer here; every other op goes to `remote`. */
export function splitInvoker(local: HostPorts, localKeys: ReadonlySet<OpEntry['port']>, remote: PortInvoker): PortInvoker {
  const near: PortInvoker = directInvoker(local);
  return { invoke: (entry: OpEntry, args: CborMap): PortReply | undefined => (localKeys.has(entry.port) ? near : remote).invoke(entry, args) };
}

/** Main-thread entry for a worker's call: by (group, op), re-checked against the grant. */
export function regrantedCall(ports: HostPorts, granted: ReadonlySet<Capability>, group: AbiGroup, op: number, args: CborMap): PortReply {
  const entry: OpEntry | undefined = findOp(group, op);
  if (entry === undefined) return { refused: { policy: 'unknown_op' } };
  const checked: CborMap | null = parseArgs(entry.name, args);
  if (checked === null) return { refused: { policy: 'bad_arguments' } };
  if (!entry.admits(checked, effectiveGrant(granted))) return { refused: 'ungranted' };
  return invokePort(ports, entry, checked) ?? { refused: { unavailable: entry.port } };
}
