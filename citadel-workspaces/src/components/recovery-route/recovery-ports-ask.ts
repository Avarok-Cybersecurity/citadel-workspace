/**
 * The recovery port that asks the workspace's admins (use-recovery-ports.ts), loaded with the
 * first ask so the admin-request client and its words stay off the landing path.
 */
import WorkspaceService from '@/lib/workspace-service';
import { askAdmins as sendAsk, type AskAnswer } from '@/lib/workspace-service/admin-requests-operations';
import { askSentence, REFUSAL_SENTENCE } from '@/lib/admin-requests/words';
import type { AskOutcome } from '@/lib/recovery-route/ports';
import type { AdminRequestKind } from '@/lib/recovery-route/route';

export async function askAdmins(kind: AdminRequestKind, about: string): Promise<AskOutcome> {
  const answer: AskAnswer = await sendAsk(WorkspaceService, askSentence(kind, about));
  return answer.kind === 'asked' ? { kind: 'sent', admins: answer.admins } : { kind: 'refused', sentence: REFUSAL_SENTENCE[answer.refusal] };
}
