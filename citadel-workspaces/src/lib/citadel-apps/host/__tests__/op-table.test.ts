/**
 * The op table the host dispatches by is the generated one: group indexes canvas 0 ... log 15, ops
 * numbered from 1 within each group, every op bound to a port and an argument schema, and the
 * op names exactly the generated HostCall's (checked at compile time).
 */
import { describe, expect, it } from 'vitest';
import { OPS } from '../../sdk/generated/AbiConstants';
import type { HostCall } from '../../sdk/generated/HostCall';
import { ABI_GROUPS, groupIndex } from '../abi';
import { CAPABILITIES } from '../capabilities';
import { OP_ARGS, type OpName } from '../op-args';
import { findOp } from '../ops';

type Inner<U> = U extends Record<string, infer O> ? O : never;
type NamesOf<U> = U extends unknown ? keyof U : never;
type HostCallOp = NamesOf<Inner<HostCall>>;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameNames: Same<HostCallOp, OpName> = true;

describe('the op table', () => {
  it('names exactly the generated HostCall ops', () => {
    expect(sameNames).toBe(true);
    expect(Object.keys(OP_ARGS).sort()).toEqual(OPS.map((o) => o.name).sort());
  });

  it('indexes the groups canvas 0 ... log 15, topic 16', () => {
    expect(ABI_GROUPS.map(groupIndex)).toEqual(Array.from({ length: 17 }, (_, i: number) => i));
    expect([ABI_GROUPS[0], ABI_GROUPS[15], ABI_GROUPS[16]]).toEqual(['canvas', 'log', 'topic']);
  });

  it('numbers ops from 1 within each group, each bound and found', () => {
    for (const g of ABI_GROUPS) {
      const ops: number[] = OPS.filter((o) => o.group === g).map((o) => o.op);
      expect([g, ops]).toEqual([g, ops.map((_, i: number) => i + 1)]);
    }
    for (const o of OPS) expect(findOp(o.group, o.op)?.name).toBe(o.name);
    expect(findOp('canvas', 0)).toBeUndefined();
  });

  it('carries the SDK capability list: 33, storage.files and the P2P and topic planes in, presence out', () => {
    expect(CAPABILITIES.length).toBe(33);
    expect(CAPABILITIES).toEqual(expect.arrayContaining(['ihttp.p2p.serve', 'ihttp.p2p.call', 'group.topic.subscribe', 'group.topic.publish']));
    expect(CAPABILITIES).toContain('storage.files');
    expect(CAPABILITIES as readonly string[]).not.toContain('presence');
  });
});
