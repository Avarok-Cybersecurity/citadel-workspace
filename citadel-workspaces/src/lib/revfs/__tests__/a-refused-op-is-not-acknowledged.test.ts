/**
 * An operation the receiver refused was acknowledged as applied.
 *
 * `applyRemoteOp` returns the tree unchanged for every refusal — a missing
 * parent, a protected path, an occupied destination — with no signal that it
 * declined. The inbound handler acknowledged `success: true` regardless, so the
 * sender retired the operation from its retry queue for something that never
 * happened. Two trees, permanently divergent, both believing they were correct.
 *
 * And the mark: `isNewOperation` records the id at the TOP of the handler,
 * before any of the work. A refusal or a throw after that leaves it recorded as
 * handled, so the sender's redelivery takes the "already applied" path and is
 * answered with a success Ack for an operation that has never landed. The mark
 * has to be undone by anything that did not apply.
 *
 * The sender ignored the answer anyway. `registerAck` resolves with the peer's
 * `success` flag and both `sendAndAwaitAck` and `retryPendingOps` discarded it,
 * returning success for any resolution — the same failure their timeout branches
 * were written to prevent, arriving by a different route. Three halves of one
 * mechanism, each correct on its own and none connected to the next.
 */
import { describe, it, expect } from 'vitest';
import { applyRemoteOpWithOutcome } from '../tree-sync';
import type { RemoteOpOutcome } from '../remote-op-outcome';
import { RevfsOpType } from '@/types/revfs-types';
import type { RevfsNode, RevfsOperation } from '@/types/revfs-types';
import { createDefaultTree } from '../tree-queries';

function op(overrides: Partial<RevfsOperation>): RevfsOperation {
  return { op_id: 'o1', op_type: RevfsOpType.Mkdir, path: '/x', timestamp: 1, ...overrides } as RevfsOperation;
}

describe('applying a remote operation', () => {
  it('reports a refusal when the parent does not exist', () => {
    const tree: RevfsNode = createDefaultTree();
    const outcome: RemoteOpOutcome = applyRemoteOpWithOutcome(
      tree,
      op({ path: '/nowhere/deep/child' }),
      1n,
    );

    expect(outcome.applied, 'a refusal was reported as applied').toBe(false);
  });

  it('reports success for an operation that took effect', () => {
    // The opposite failure: reporting everything refused would stop every sync
    // and the assertion above cannot see it.
    const tree: RevfsNode = createDefaultTree();
    const outcome: RemoteOpOutcome = applyRemoteOpWithOutcome(tree, op({ path: '/newdir' }), 1n);

    expect(outcome.applied).toBe(true);
    expect(outcome.tree.children?.some((c: RevfsNode) => c.path === '/newdir')).toBe(true);
  });

  it('reports success for an mkdir whose directory already exists', () => {
    // Idempotence is success, not refusal: the state the sender asked for holds,
    // so it may retire the op. Treating this as a refusal would have every
    // redelivered mkdir retried to MAX_OP_RETRIES and then discarded loudly.
    const tree: RevfsNode = createDefaultTree();
    const first: RemoteOpOutcome = applyRemoteOpWithOutcome(tree, op({ path: '/twice' }), 1n);
    const second: RemoteOpOutcome = applyRemoteOpWithOutcome(first.tree, op({ path: '/twice' }), 1n);

    expect(second.applied).toBe(true);
  });

  /**
   * Move and Copy are the ops with the most ways to refuse — protected path,
   * missing source, missing destination parent, occupied destination name — and
   * a control showed the suite did not cover any of them reporting a refusal.
   * Their outcomes are the ones a sender most needs, because a relocation that
   * silently did not happen leaves the two trees pointing at different places.
   */
  it('refuses a move whose destination parent does not exist', () => {
    const tree: RevfsNode = createDefaultTree();
    const seeded: RevfsNode = applyRemoteOpWithOutcome(tree, op({ path: '/src' }), 1n).tree;

    const outcome: RemoteOpOutcome = applyRemoteOpWithOutcome(
      seeded,
      op({ op_type: RevfsOpType.Move, path: '/src', destPath: '/nowhere/src' }),
      1n,
    );

    expect(outcome.applied, 'a move into a missing parent was reported as applied').toBe(false);
  });

  it('refuses a copy onto a name that is already taken', () => {
    const tree: RevfsNode = createDefaultTree();
    let seeded: RevfsNode = applyRemoteOpWithOutcome(tree, op({ path: '/a' }), 1n).tree;
    seeded = applyRemoteOpWithOutcome(seeded, op({ path: '/b' }), 1n).tree;

    const outcome: RemoteOpOutcome = applyRemoteOpWithOutcome(
      seeded,
      op({ op_type: RevfsOpType.Copy, path: '/a', destPath: '/b' }),
      1n,
    );

    expect(outcome.applied, 'a copy onto an occupied name was reported as applied').toBe(false);
  });

  it('applies a move that can be made', () => {
    // The opposite failure: refusing every relocation would pass both assertions
    // above while breaking the feature outright.
    const tree: RevfsNode = createDefaultTree();
    let seeded: RevfsNode = applyRemoteOpWithOutcome(tree, op({ path: '/from' }), 1n).tree;
    seeded = applyRemoteOpWithOutcome(seeded, op({ path: '/into' }), 1n).tree;

    const outcome: RemoteOpOutcome = applyRemoteOpWithOutcome(
      seeded,
      op({ op_type: RevfsOpType.Move, path: '/from', destPath: '/into/from' }),
      1n,
    );

    expect(outcome.applied).toBe(true);
    expect(outcome.tree.children?.some((c: RevfsNode) => c.path === '/from')).toBe(false);
    expect(
      outcome.tree.children
        ?.find((c: RevfsNode) => c.path === '/into')?.children
        ?.some((c: RevfsNode) => c.path === '/into/from'),
    ).toBe(true);
  });

  it('refuses to remove a protected directory, and says so', () => {
    const tree: RevfsNode = createDefaultTree();
    const protectedPath: string | undefined = tree.children?.[0]?.path;
    expect(protectedPath, 'the default tree has no directories to protect').toBeDefined();

    const outcome: RemoteOpOutcome = applyRemoteOpWithOutcome(
      tree,
      op({ op_type: RevfsOpType.Rmdir, path: protectedPath as string }),
      1n,
    );

    expect(outcome.applied).toBe(false);
    expect(
      outcome.tree.children?.some((c: RevfsNode) => c.path === protectedPath),
      'a protected directory was removed',
    ).toBe(true);
  });
});

/**
 * The receiver's answer has to travel, and the sender has to read it.
 *
 * These drive the whole handler so the three halves are exercised together:
 * `applyRemoteOpWithOutcome` reporting, the handler putting that in the Ack and
 * undoing the seen-mark, and the sender honouring the resolved value.
 */
import { createTestService, defaultIntentHandler, getState, ALICE, BOB } from './revfs-service-test-helpers';
import type { RevfsService } from '../revfs-service';
import type { RevfsState } from '../revfs-state';
import type { RevfsIntent, RevfsIntentResult } from '@/types/revfs-intents';
import { peerTreeKey } from '../tree-queries';
import { forgetSeenOperations } from '../seen-operations';

function sentAcks(sent: RevfsOperation[]): RevfsOperation[] {
  return sent.filter((o) => o.op_type === RevfsOpType.Ack);
}

describe('acknowledging an operation the receiver could not apply', () => {
  it('answers success:false rather than success:true', async (): Promise<void> => {
    forgetSeenOperations();
    const sent: RevfsOperation[] = [];
    const service: RevfsService = createTestService((intent: RevfsIntent): RevfsIntentResult => {
      if (intent.type === 'send-revfs-op') {
        sent.push(intent.operation);
        return { type: 'send-revfs-op', success: true };
      }
      return defaultIntentHandler()(intent);
    });
    const state: RevfsState = getState(service);
    state.setTree(peerTreeKey(ALICE, BOB), createDefaultTree());

    // A parent that does not exist: applyRemoteOp declines.
    await service.handleRevfsOperation(BOB, ALICE, op({
      op_id: 'refused-1', path: '/nowhere/deep/child',
    }));

    const acks: RevfsOperation[] = sentAcks(sent);
    expect(acks, 'the receiver sent no acknowledgement at all').toHaveLength(1);
    expect(
      acks[0].success,
      'a refused operation was acknowledged as applied, so the sender retired it',
    ).toBe(false);
  });

  it('forgets a refused operation so a retry is a real attempt', async (): Promise<void> => {
    // The seen-mark is taken before the work. Left in place after a refusal, the
    // sender's redelivery hits the "already applied" branch, which answers
    // success:true unconditionally — turning a retryable refusal into a
    // permanent, silent loss.
    forgetSeenOperations();
    const sent: RevfsOperation[] = [];
    const service: RevfsService = createTestService((intent: RevfsIntent): RevfsIntentResult => {
      if (intent.type === 'send-revfs-op') {
        sent.push(intent.operation);
        return { type: 'send-revfs-op', success: true };
      }
      return defaultIntentHandler()(intent);
    });
    const state: RevfsState = getState(service);
    const key: string = peerTreeKey(ALICE, BOB);
    state.setTree(key, createDefaultTree());

    await service.handleRevfsOperation(BOB, ALICE, op({ op_id: 'refused-2', path: '/nowhere/x' }));
    // Now the parent exists, so the same op CAN apply. This is the redelivery
    // the sender makes after its failure ack.
    state.setTree(key, applyRemoteOpWithOutcome(
      state.getTree(key) as RevfsNode,
      op({ op_id: 'setup', path: '/nowhere' }),
      ALICE,
    ).tree);

    sent.length = 0;
    await service.handleRevfsOperation(BOB, ALICE, op({ op_id: 'refused-2', path: '/nowhere/x' }));

    // The discriminating assertion is the TREE, not the ack.
    //
    // The "already applied" short-circuit also answers success:true, so an ack
    // assertion here passes whether or not the mark was undone — verified by
    // control, which is how this test came to check the wrong thing first. What
    // separates the two is whether the retry actually created the node.
    expect(
      (state.getTree(key) as RevfsNode).children
        ?.find((c: RevfsNode) => c.path === '/nowhere')?.children
        ?.some((c: RevfsNode) => c.path === '/nowhere/x'),
      'the retry was answered from the seen-set instead of being applied, so the \
node the sender asked for is still missing while the sender has been told it landed',
    ).toBe(true);

    const acks: RevfsOperation[] = sentAcks(sent);
    expect(acks).toHaveLength(1);
    expect(acks[0].success).toBe(true);
  });
});
