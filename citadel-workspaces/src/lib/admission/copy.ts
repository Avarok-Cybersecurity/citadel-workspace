/** Every sentence the human-check UI says, in one place. */
export const ADMISSION_COPY: {
  readonly settingLabel: string;
  readonly settingHint: string;
  readonly confirmTitle: string;
  readonly confirmBody: string;
  readonly adminsOnly: string;
  readonly serverUnsupported: string;
  readonly required: string;
  readonly failed: string;
  readonly unavailable: string;
  readonly completeFirst: string;
  readonly signInAgain: string;
  readonly finishTitle: string;
  readonly finishBody: string;
  readonly workspaceLabel: string;
  readonly workspaceHint: string;
  readonly workspaceNeeded: string;
  readonly workspaceInvalid: string;
} = {
  settingLabel: 'Require a human check (Cloudflare Turnstile) to sign in',
  settingHint: 'Everyone signing in or creating an account here completes a quick check first, which stops automated password guessing.',
  confirmTitle: 'Require a human check to sign in?',
  confirmBody: "Members on older versions of the Citadel app won't be able to sign in until they update.",
  adminsOnly: 'Only workspace admins can change this.',
  serverUnsupported: "This workspace's server doesn't support this setting yet.",
  required: 'This workspace asks for a quick human check. Complete it, then try again.',
  failed: "That check didn't go through — please try again",
  unavailable: "This workspace asks for a human check, but it couldn't be loaded. Check your connection and try again.",
  completeFirst: 'Complete the human check first.',
  signInAgain: 'Please sign in again',
  finishTitle: 'Finish signing in',
  finishBody: 'Your account is ready. This workspace asks for one more quick check before you sign in.',
  workspaceLabel: 'Workspace address',
  workspaceHint: 'The check is tied to your workspace. Enter its address, like acme.work.avarok.net.',
  workspaceNeeded: 'Enter your workspace address so the human check can be tied to it.',
  workspaceInvalid: "That isn't a workspace address. It looks like acme.work.avarok.net.",
} as const;

/** Must match what the workspace server's siteverify expects for each form. */
export const ADMISSION_ACTION: { readonly signIn: 'sign-in'; readonly register: 'register' } = { signIn: 'sign-in', register: 'register' } as const;
