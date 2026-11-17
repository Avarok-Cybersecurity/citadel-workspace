/**
 * The optional profile fields a new account fills in on the wizard's Profile
 * step: a picture, an email and a job title.
 *
 * Registration cannot carry them -- the SDK's register call knows a username,
 * a password and a full name -- so they are sent afterwards as one
 * `UpdateUserProfile`, once the new session is in the workspace. The server
 * refuses that request for an account it has not enrolled yet ("User not
 * found"), and the first `Workspace` answer is the proof it has: `GetWorkspace`
 * is refused to a non-member.
 *
 * None of this may undo or block the registration. A value the server would
 * refuse is left out and named; a failed send is named. Either way the user is
 * told where to finish it.
 */
import type { ProfileUpdate } from '@/lib/workspace-service/messaging-operations';
import { validateProfileEmail, validateProfileTitle } from '@/lib/profile-rules';
import { describeFailure } from '@/lib/failure-message';

export interface SignupProfileFields {
  /** Base64 from `processAvatarImage`, or null when none was chosen. */
  avatarData: string | null;
  email: string;
  title: string;
}

export interface SignupProfilePlan {
  /** Null when there is nothing to send. */
  update: ProfileUpdate | null;
  /** Why a field that was filled in is not being sent. */
  skipped: string[];
}

/** What to send, from what was typed. Blank fields are not sent at all. */
export function planSignupProfileUpdate(fields: SignupProfileFields): SignupProfilePlan {
  const update: ProfileUpdate = {};
  const skipped: string[] = [];

  if (fields.avatarData !== null && fields.avatarData !== '') update.avatarData = fields.avatarData;

  const email: string = fields.email.trim();
  if (email !== '') {
    const problem: string | null = validateProfileEmail(email);
    if (problem === null) update.email = email;
    else skipped.push(`email (${problem})`);
  }

  const title: string = fields.title.trim();
  if (title !== '') {
    const problem: string | null = validateProfileTitle(title);
    if (problem === null) update.title = title;
    else skipped.push(`job title (${problem})`);
  }

  return { update: Object.keys(update).length > 0 ? update : null, skipped };
}

export interface SignupProfileEffects {
  /** Resolves once the new session is in the workspace; rejects if it never is. */
  waitForWorkspace: () => Promise<void>;
  send: (update: ProfileUpdate) => Promise<void>;
  /** Tell the user what did not get saved. */
  reportFailure: (description: string) => void;
}

export const SETTINGS_HINT: string = 'You can add it in Settings > General.';

/** Never rejects: every failure is reported through `reportFailure`. */
export async function applySignupProfile(
  plan: SignupProfilePlan,
  effects: SignupProfileEffects,
): Promise<void> {
  if (plan.skipped.length > 0) {
    effects.reportFailure(`Not saved: ${plan.skipped.join('; ')}. ${SETTINGS_HINT}`);
  }
  if (plan.update === null) return;
  try {
    await effects.waitForWorkspace();
    await effects.send(plan.update);
  } catch (error: unknown) {
    const reason: string = describeFailure(error, 'no reason was given');
    effects.reportFailure(
      `Your account was created, but your profile details were not saved (${reason}). ${SETTINGS_HINT}`,
    );
  }
}
