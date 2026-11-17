/**
 * RevfsState Tests
 *
 * No mocking needed — RevfsState is pure in-memory state.
 */

import { describe, it, expect, vi  } from 'vitest';
import { RevfsState } from '../revfs-state';
import type { RevfsNode, RevfsPendingOp } from '@/types/revfs-types';
import { RevfsOpType } from '@/types/revfs-types';

function makeTree(path: string = '/'): RevfsNode {
  return { name: '/', type: 'directory', path, children: [], createdAt: 1, updatedAt: 1 };
}

function makePendingOp(opId: string): RevfsPendingOp {
  return {
    operation: { op_id: opId, op_type: RevfsOpType.Mkdir, path: '/test', timestamp: Date.now() },
    retryCount: 0,
    createdAt: Date.now(),
  };
}

describe('RevfsState', () => {
  describe('tree operations', () => {
    it('getTree returns undefined for unknown key', () => {
      const state: RevfsState = new RevfsState();
      expect(state.getTree('unknown')).toBeUndefined();
    });

    it('setTree + getTree roundtrip', () => {
      const state: RevfsState = new RevfsState();
      const tree: RevfsNode = makeTree();
      state.setTree('100_200', tree);
      expect(state.getTree('100_200')).toBe(tree);
    });

    it('setTree notifies listeners', () => {
      const state: RevfsState = new RevfsState();
      const calls: string[] = [];
      state.onTreeChanged((key) => calls.push(key));
      state.setTree('100_200', makeTree());
      expect(calls).toEqual(['100_200']);
    });
  });

  describe('pending ops', () => {
    it('getPendingOps returns empty array for unknown key', () => {
      const state: RevfsState = new RevfsState();
      expect(state.getPendingOps('unknown')).toEqual([]);
    });

    it('addPendingOp + getPendingOps roundtrip', () => {
      const state: RevfsState = new RevfsState();
      const op: RevfsPendingOp = makePendingOp('op-1');
      state.addPendingOp('100_200', op);
      expect(state.getPendingOps('100_200')).toHaveLength(1);
      expect(state.getPendingOps('100_200')[0].operation.op_id).toBe('op-1');
    });

    it('removePendingOp filters by opId', () => {
      const state: RevfsState = new RevfsState();
      state.addPendingOp('100_200', makePendingOp('op-1'));
      state.addPendingOp('100_200', makePendingOp('op-2'));
      state.removePendingOp('100_200', 'op-1');
      const ops: RevfsPendingOp[] = state.getPendingOps('100_200');
      expect(ops).toHaveLength(1);
      expect(ops[0].operation.op_id).toBe('op-2');
    });

    it('setPendingOps replaces all ops', () => {
      const state: RevfsState = new RevfsState();
      state.addPendingOp('100_200', makePendingOp('op-1'));
      state.setPendingOps('100_200', [makePendingOp('op-new')]);
      const ops: RevfsPendingOp[] = state.getPendingOps('100_200');
      expect(ops).toHaveLength(1);
      expect(ops[0].operation.op_id).toBe('op-new');
    });
  });

  describe('ACK tracking', () => {
    it('registerAck + resolveAck resolves promise', async () => {
      const state: RevfsState = new RevfsState();
      const promise: Promise<boolean> = state.registerAck('op-1', 5000);
      state.resolveAck('op-1', true);
      const result: boolean = await promise;
      expect(result).toBe(true);
    });

    it('resolveAck with unknown opId is a no-op', () => {
      const state: RevfsState = new RevfsState();
      // Should not throw
      state.resolveAck('unknown-op', true);
    });

    it('registerAck rejects on timeout', async () => {
      const state: RevfsState = new RevfsState();
      const promise: Promise<boolean> = state.registerAck('op-1', 10);
      await expect(promise).rejects.toThrow('ACK timeout');
    });
  });

  describe('listeners', () => {
    it('unsubscribe stops notifications', () => {
      const state: RevfsState = new RevfsState();
      const calls: string[] = [];
      const unsub: () => void = state.onTreeChanged((key): number => calls.push(key));
      state.setTree('100_200', makeTree());
      expect(calls).toHaveLength(1);
      unsub();
      state.setTree('100_200', makeTree());
      expect(calls).toHaveLength(1);
    });

    it('listener error does not break other listeners', () => {
      const state: RevfsState = new RevfsState();
      const consoleSpy: ReturnType<typeof vi.spyOn> = vi.spyOn(console, 'error').mockImplementation((): void => {});
      const calls: string[] = [];
      state.onTreeChanged(() => { throw new Error('boom'); });
      state.onTreeChanged((key) => calls.push(key));
      state.setTree('100_200', makeTree());
      expect(calls).toEqual(['100_200']);
      consoleSpy.mockRestore();
    });
  });
});
