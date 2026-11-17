/**
 * What the agent can take from this browser, for the Send dialog: whether it stages
 * uploads (2 GB) or takes them inline only (16 MB), or null until it has said.
 *
 * The dialog used to assume 16 MB until the answer came, and to keep assuming it if
 * the question failed, so a 40 MB file dropped in that window was refused with the
 * false advice to update the agent (UX review, finding 7). Unknown is now unknown,
 * and a failed question is said.
 */
import { useEffect, useState } from 'react';
import { agentNativePicker, agentStagesUploads } from '@/lib/agent-conversations/capabilities';
import { TIMEOUT } from '@/lib/timeout-constants';

/** The agent's answer, or a failure once the agent has had as long as a session request. */
function askBounded(): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => reject(new Error('no answer')), TIMEOUT.SESSION_MANAGEMENT_MS);
    agentStagesUploads().then((v: boolean) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
  });
}

export interface SendCeiling {
  stagesUploads: boolean | null;
  /** Whether the agent can open a native file dialog: undefined until it says, and if it never does. */
  nativePicker?: boolean;
  /** Why the agent could not be asked, or null. */
  failure: string | null;
}

/** Asked afresh each time the dialog opens, so "reopen to ask again" is true. */
export function useSendCeiling(isOpen: boolean): SendCeiling {
  const [ceiling, setCeiling] = useState<SendCeiling>({ stagesUploads: null, failure: null });
  useEffect((): (() => void) => {
    let live: boolean = true;
    // Cleared first: the status element is empty when the answer (or failure) arrives,
    // so the change is what a screen reader announces.
    setCeiling({ stagesUploads: null, failure: null });
    if (!isOpen) return (): void => { live = false; };
    askBounded().then(
      (stages: boolean): void => { if (live) setCeiling((c: SendCeiling): SendCeiling => ({ ...c, stagesUploads: stages, failure: null })); },
      (error: unknown): void => {
        if (!live) return;
        const why: string = error instanceof Error ? error.message : String(error);
        // Known to be unknown: the inline route is the one every agent takes.
        setCeiling((c: SendCeiling): SendCeiling => ({ ...c, stagesUploads: false, failure: `Could not ask your Citadel agent how large a file it takes (${why}); assuming 16 MB. Close and reopen this dialog to ask again.` }));
      },
    );
    // Asked on its own: unknown stays unknown (offered, as before) however long the agent takes.
    agentNativePicker().then(
      (nativePicker: boolean | undefined): void => { if (live) setCeiling((c: SendCeiling): SendCeiling => ({ ...c, nativePicker })); },
      (): void => undefined,
    );
    return (): void => { live = false; };
  }, [isOpen]);
  return ceiling;
}
