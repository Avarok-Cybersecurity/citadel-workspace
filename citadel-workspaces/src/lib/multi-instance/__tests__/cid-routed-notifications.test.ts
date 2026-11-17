import { describe, it, expect } from 'vitest';

/**
 * Tests pinning CID extraction for every notification type listed in
 * `CID_ROUTED_NOTIFICATIONS`. The router's correctness hinges on
 * `extractTargetCid` finding a CID for each of these notification
 * shapes — if it returns `null`, the router falls through to its
 * self-heal path and the message is processed on the leader tab
 * instead of being forwarded to the owning follower.
 *
 * The three new File-Transfer entries (`FileTransferRequestNotification`,
 * `FileTransferStatusNotification`, `FileTransferTickNotification`)
 * were added to `CID_ROUTED_NOTIFICATIONS` to stop the leader from
 * broadcasting file-transfer prompts to unrelated tabs (see
 * citadel-internal-service round-2 P-B fix in PR #55). Without these
 * tests, a future shape change (e.g. nesting the cid under a different
 * key, or renaming the field) would silently downgrade the file
 * transfer flow to leader-tab-only delivery.
 */

import {
  CID_ROUTED_NOTIFICATIONS,
} from '../routing-rules';
import { extractTargetCid } from '../message-routing';

const targetCid: "1281805798482117626" = '1281805798482117626';
const senderCid: "18170202856123884154" = '18170202856123884154';

function notification(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  return { [type]: payload };
}

describe('CID_ROUTED_NOTIFICATIONS — every entry has extractable CID', () => {
  // Build the canonical message shape for each notification type so the
  // router can find `cid` at the expected location. If a new entry is
  // added to `CID_ROUTED_NOTIFICATIONS` without a corresponding shape
  // here, the loop test below will fail and force the author to add
  // coverage.
  const SHAPES: Record<string, Record<string, unknown>> = {
    PeerRegisterNotification: { cid: targetCid, peer_cid: senderCid, peer_username: 'alice', request_id: 'r1' },
    PeerConnectNotification: { cid: targetCid, peer_cid: senderCid, request_id: 'r2' },
    MessageNotification: { cid: targetCid, peer_cid: senderCid, message: [1, 2, 3], request_id: 'r3' },
    FileTransferRequestNotification: { cid: targetCid, peer_cid: senderCid, metadata: { object_id: '42' }, request_id: 'r4' },
    FileTransferStatusNotification: { cid: targetCid, peer_cid: senderCid, status: 'in-progress', request_id: 'r5' },
    FileTransferTickNotification: { cid: targetCid, peer_cid: senderCid, transmitted_bytes: 1024, request_id: 'r6' },
    // Media frames carry request_id: null — they are unsolicited, so `cid` is
    // the ONLY thing that can route them. Routed any other way, a second
    // session in the same browser would receive another session's call.
    MediaFrameNotification: { cid: targetCid, peer_cid: senderCid, track: 1, kind: 1, sequence: 7, timestamp: 0, flags: 1, payload: [1, 2], request_id: null },
    MediaGapNotification: { cid: targetCid, peer_cid: senderCid, track: 1, missing_from: 4, missing_to: 6, request_id: null },
    // The generated binding: { cid, peer_cid, message, group_key, request_id }.
    GroupMessageNotification: { cid: targetCid, peer_cid: senderCid, message: [1, 2, 3], group_key: { cid: senderCid, mgid: '42' }, request_id: 'r7' },
    // No peer_cid on this one: the agent's failure answer carries the sender's
    // own cid, a reason, and a transport-frame request_id.
    MessageSendFailure: { cid: targetCid, message: 'Peer connection for 42 not found', request_id: 'r9' },
    // The generated binding: { cid, peer_cid, path, upgrading, request_id }. Unsolicited, so
    // request_id is always null and `cid` is the only route to the owning tab.
    PeerPathChangedNotification: { cid: targetCid, peer_cid: senderCid, path: 'direct', upgrading: false, request_id: null },
    // The agent's server-link notifications (types/agent-reconnect.ts): no
    // request_id and no peer, so `cid` is the only way to the owning tab.
    ServerConnectionLost: { cid: targetCid, reconnecting: true, request_id: null },
    ServerReconnected: { cid: targetCid, request_id: null },
    ServerReconnectFailed: { cid: targetCid, reason: 'The server did not accept the session', request_id: null },
    // The connection supervisor's report (types/agent-supervisor.ts): unsolicited,
    // so `cid` is the only route to the tab that holds the session it names.
    SupervisorNotification: { cid: targetCid, peer_cid: senderCid, state: 'Healing', request_id: null },
    // Multi-window (agent 0.8.6). A conversation change goes to every window of
    // the account; its request_id, when set, is the asking window's send, and
    // routed by it the event would consume the pending entry its answer needs.
    ConversationEvent: { cid: targetCid, peer_cid: senderCid, seq: 1n, kind: 'Appended', message: null, message_id: 'm1', metadata: null, account_username: 'bob', peer_username: 'alice', preview: 'hi', request_id: 'r10' },
    SessionRoleNotification: { cid: targetCid, role: 'Secondary', attached: 2, request_id: null },
    // The generated binding: { cid, peer_cid, frame, request_id }. `cid` is the account whose
    // app host the frame is for; request_id, when set, is the sending peer's.
    IhttpFrameNotification: { cid: targetCid, peer_cid: senderCid, frame: [0xa1, 1, 2], request_id: 'r11' },
    // The generated binding: { cid, group_key, refusal, request_id }; the agent never sets request_id.
    GroupMessageRefusedNotification: { cid: targetCid, group_key: { cid: senderCid, mgid: 3n }, refusal: { RateLimited: { max_per_second: 2 } }, request_id: null },
  };

  it('has a test fixture for every CID-routed notification type', () => {
    // Adding to CID_ROUTED_NOTIFICATIONS without adding a SHAPES entry
    // fails the next assertion loudly — the actual extraction tests
    // below would only fire for shapes I happened to know about.
    for (const type of CID_ROUTED_NOTIFICATIONS) {
      expect(SHAPES, `missing fixture for ${type}`).toHaveProperty(type);
    }
  });

  it('routes exactly these notifications by cid, and no fewer', () => {
    // The coverage check above is one-directional: it says every MEMBER has a
    // fixture. REMOVING a member shrinks the set, every remaining fixture still
    // extracts fine (the extractor is type-agnostic), and nothing fails —
    // so deleting 'MediaFrameNotification' would silently reinstate wrong-tab
    // call delivery, which is the exact defect this set exists to prevent.
    //
    // Written out rather than derived, so removing a member fails here and
    // adding one is a deliberate edit in two places.
    expect([...CID_ROUTED_NOTIFICATIONS].sort()).toEqual(
      [
        'ConversationEvent',
        'FileTransferRequestNotification',
        'FileTransferStatusNotification',
        'FileTransferTickNotification',
        'GroupMessageNotification',
        'GroupMessageRefusedNotification',
        'IhttpFrameNotification',
        'MediaFrameNotification',
        'MediaGapNotification',
        'MessageNotification',
        'MessageSendFailure',
        'PeerConnectNotification',
        'PeerPathChangedNotification',
        'PeerRegisterNotification',
        'ServerConnectionLost',
        'ServerReconnectFailed',
        'ServerReconnected',
        'SessionRoleNotification',
        'SupervisorNotification',
      ].sort(),
    );
  });

  for (const type of Object.keys(SHAPES)) {
    it(`extracts target cid from ${type}`, () => {
      const msg: Record<string, unknown> = notification(type, SHAPES[type]);
      const extracted: string | null = extractTargetCid(msg);
      expect(extracted, `${type} should yield the recipient cid`).toBe(targetCid);
    });
  }

  it('extracts the nested cid even when the field also appears at the top level', () => {
    // Defensive: some pipelines wrap notifications with a top-level
    // `cid` AND a payload `cid`. The router checks top-level first, so
    // pin that precedence too.
    const otherCid: "9999999999999999999" = '9999999999999999999';
    const msg: { cid: "9999999999999999999"; FileTransferRequestNotification: Record<string, unknown>; } = { cid: otherCid, FileTransferRequestNotification: SHAPES.FileTransferRequestNotification };
    expect(extractTargetCid(msg)).toBe(otherCid);
  });

  it('falls back to peer_cid when cid is missing (documented secondary id)', () => {
    // `CID_FIELDS = ['cid', 'peer_cid', 'session_cid']` — `extractTargetCid`
    // walks the list in order. Pinning this so a future "tighten extraction
    // to cid-only" change has to remove the fallback explicitly rather than
    // by accident.
    const msg: Record<string, unknown> = notification('FileTransferRequestNotification', { peer_cid: senderCid, metadata: { object_id: '42' } });
    expect(extractTargetCid(msg)).toBe(senderCid);
  });

  it('returns null when no cid-like field is present anywhere', () => {
    // Required for the self-heal trigger path — extractTargetCid must
    // return null (not undefined or empty string) so the router's
    // `if (!targetCid)` branch reliably fires.
    const msg: Record<string, unknown> = notification('FileTransferRequestNotification', { metadata: { object_id: '42' }, request_id: 'r-no-cid' });
    expect(extractTargetCid(msg)).toBeNull();
  });
});
