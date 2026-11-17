/**
 * Shared test helpers for RevfsService tests.
 *
 * Mock justification: RevfsIO is the I/O boundary (SBIO pattern).
 * We mock RevfsIO.execute() to verify the service orchestrates
 * pure logic, state, and I/O intents correctly without needing
 * OPFS or network access.
 */

import { vi } from 'vitest';
import { RevfsService } from '../revfs-service';
import type { RevfsIntent, RevfsIntentResult } from '@/types/revfs-intents';
import { RevfsOpType , type RevfsOperation } from '@/types/revfs-types';
import { RevfsState } from '../revfs-state';

// ── Constants ───────────────────────────────────────────────────────────

export const ALICE: bigint = 100n;
export const BOB: bigint = 200n;

// ── Types ───────────────────────────────────────────────────────────────

export type IntentHandler = (intent: RevfsIntent) => RevfsIntentResult;

// ── Helpers ─────────────────────────────────────────────────────────────

export function getState(service: RevfsService): RevfsState {
  return (service as unknown as { state: RevfsState }).state;
}

/**
 * Creates a test service with mocked IO.
 * When autoAck=true (default), send-revfs-op for non-ACK ops
 * auto-resolves the pending ACK so mkdir/rmdir don't hang.
 */
export function createTestService(
  intentHandler: IntentHandler,
  opts: { autoAck?: boolean } = {},
): RevfsService {
  const { autoAck = true } = opts;
  const service: RevfsService = new RevfsService();
  service.initialize({
    sendP2PMessageReliable: vi.fn(),
    getCurrentCid: vi.fn().mockResolvedValue(ALICE),
    sendInternalServiceRequest: vi.fn(),
    // The channel is up: these tests are about what travels over it.
    openPeerChannel: async (): Promise<boolean> => true,
  });

  const io: { execute: (i: RevfsIntent) => Promise<RevfsIntentResult>; } = (service as unknown as { io: { execute: (i: RevfsIntent) => Promise<RevfsIntentResult> } }).io;
  const state: RevfsState = getState(service);

  io.execute = vi.fn(async (intent: RevfsIntent) => {
    const result: RevfsIntentResult = intentHandler(intent);

    if (autoAck && intent.type === 'send-revfs-op' && result.type === 'send-revfs-op' && result.success) {
      const op: RevfsOperation = (intent as { operation: RevfsOperation }).operation;
      if (op.op_type !== RevfsOpType.Ack && op.op_type !== RevfsOpType.SyncRequest && op.op_type !== RevfsOpType.SyncResponse) {
        queueMicrotask(() => state.resolveAck(op.op_id, true));
      }
    }

    return result;
  });
  return service;
}

export function defaultIntentHandler(overrides?: Partial<Record<RevfsIntent['type'], IntentHandler>>): IntentHandler {
  return (intent: RevfsIntent): RevfsIntentResult => {
    if (overrides?.[intent.type]) {
      return overrides[intent.type]!(intent);
    }
    switch (intent.type) {
      case 'send-revfs-op':
        return { type: 'send-revfs-op', success: true };
      case 'persist-tree':
        return { type: 'persist-tree', success: true };
      case 'load-tree':
        return { type: 'load-tree', tree: null };
      case 'persist-pending-ops':
        return { type: 'persist-pending-ops', success: true };
      case 'load-pending-ops':
        return { type: 'load-pending-ops', ops: [] };
      case 'backend-send-file':
        return { type: 'backend-send-file', success: true };
      case 'backend-download-file':
        return { type: 'backend-download-file', success: true, downloadPath: '/tmp/file' };
      case 'backend-delete-file':
        return { type: 'backend-delete-file', success: true };
      case 'backend-read-pulled-chunk':
        return { type: 'backend-read-pulled-chunk', answer: { kind: 'failed', message: 'no file is pulled in this test' } };
    }
  };
}

export function getExecuteCalls(service: RevfsService): RevfsIntent[] {
  const io: { execute: ReturnType<typeof vi.fn> } =
    (service as unknown as { io: { execute: ReturnType<typeof vi.fn> } }).io;
  return io.execute.mock.calls.map((c: unknown[]) => c[0] as RevfsIntent);
}
