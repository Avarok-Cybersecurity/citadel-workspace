/**
 * Starting an outbound call.
 *
 * Its own module because the rule it enforces is not one line: "am I already in
 * a call?" has to be asked THREE times, and which state it is asked of matters.
 * Inline in the provider that reasoning was one comment among a dozen other
 * call actions; here it is the whole subject of the file.
 */

import { toast } from 'sonner';
import type { MutableRefObject } from 'react';
import type { CallManager } from '@/lib/call/call-manager';
import type { CallSession } from '@/lib/call/call-session';
import { callBusyReason } from '@/lib/call/call-busy';
import type { CallMediaKinds } from '@/types/call-signals';
import type { CallMoment } from './report-call-system-unavailable';
import type { CallHome } from '@/lib/call/call-state';

export interface StartCallDeps {
  managerRef: MutableRefObject<CallManager | null>;
  ensureManager: () => Promise<CallManager | null>;
  ensureSession: () => Promise<CallSession>;
  teardown: () => void;
  setCaptureFailure: (failure: null) => void;
  reportCallSystemUnavailable: (moment: CallMoment) => void;
}

export async function startCall(
  deps: StartCallDeps,
  peers: Array<{ cid: bigint; username: string }>,
  video: boolean,
  home: CallHome,
): Promise<void> {
  // Before capturing anything. The group entry path has refused a second
  // call since it was written; this one never did, so from any other
  // conversation during an active call both call buttons were live -- and
  // pressing one overwrote the live stream and pump without stopping
  // either, leaving the camera light on until a reload while the original
  // peer waited out their 20s silence timeout.
  // The manager's own state, not the React copy: a call that started
  // milliseconds ago has not necessarily reached this closure yet, and the
  // whole failure is a second start racing the first.
  const busy: string | null = callBusyReason(deps.managerRef.current?.getState() ?? null);
  if (busy) {
    toast.error(busy);
    return;
  }

  deps.setCaptureFailure(null);
  const manager: CallManager | null = await deps.ensureManager();
  if (!manager) return deps.reportCallSystemUnavailable('start');

  const session: CallSession = await deps.ensureSession();

  // Asked AGAIN, because the check above is now several awaits old and the
  // longest of them is still ahead: `session.start` raises the browser's
  // permission prompt, which a person can leave sitting for minutes. An
  // incoming call accepted in that window makes us busy, and the capture
  // below replaces the live call's stream and pump on the shared session.
  // Re-checking here means we never reach the capture at all.
  const busyBeforeCapture: string | null = callBusyReason(deps.managerRef.current?.getState() ?? null);
  if (busyBeforeCapture) {
    toast.error(busyBeforeCapture);
    return;
  }

  const got: CallMediaKinds | null = await session.start({ audio: true, video, screen: false });
  // Capture failing means there is nothing to send, so nobody is rung — a
  // ringing phone for a call that cannot carry audio wastes their time.
  if (!got) {
    deps.teardown();
    return;
  }

  // And once more before announcing anything. `manager.start` overwrites
  // the manager's call state outright, so reaching it while another call is
  // live ends that call for us without telling its peer -- they wait out
  // their whole silence timeout. No deps.teardown on this branch: the session is
  // shared, and the live call is the one using it now.
  const busyAfterCapture: string | null = callBusyReason(deps.managerRef.current?.getState() ?? null);
  if (busyAfterCapture) {
    toast.error(busyAfterCapture);
    return;
  }

  const callId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  // The invite announces our provisional codec; the accept's decode list
  // may change it, in which case the signal path announces the new one.
  await manager.start(callId, peers, got, home, session.getCodec());
}
