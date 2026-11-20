/** Every sentence the recovery phrase, account recovery and the recovery console say, in one place. */

export const PHRASE_COPY = {
  title: 'Save your recovery phrase',
  body:
    'These 24 words are the only way back into your account if you forget your password or lose your ' +
    "security keys. Write them down, in order, and keep them somewhere private. They won't be shown again.",
  warning: 'Anyone with these words can take over your account. Citadel will never ask you for them.',
  written: "I've written down all 24 words",
  confirmTitle: 'Check what you wrote down',
  confirmBody: 'Type the words at these positions, so a phrase that was never written down is caught now.',
  confirmMismatch: "Those words don't match your phrase. Check what you wrote down and try again.",
  showAgain: 'Show the phrase again',
  regenerate: 'New recovery phrase',
  regenerateWarning: 'Your current phrase stops working at once.',
  settingsTitle: 'Recovery phrase',
  settingsBody: 'Lets you back in if you forget your password or lose your keys.',
} as const;

export const RECOVER_COPY = {
  link: 'Forgot your password? Recover your account',
  title: 'Recover your account',
  body: 'Enter your username and the 24-word recovery phrase you saved when you created the account.',
  server: 'Workspace server',
  device: 'Name this device',
  deviceHint: 'Shown in your account’s sign-in history.',
  phrase: 'Recovery phrase',
  phraseHint: 'Paste the whole phrase into the first box, or type one word in each.',
  submit: 'Recover account',
  working: 'Recovering…',
  newDevice:
    'Recovering on a device that has never signed in to this account signs out every other device. ' +
    'You can sign in on them again afterwards.',
} as const;

export const CONSOLE_COPY = {
  title: 'Recovery console',
  intro:
    'You signed in with your recovery phrase. This console can only change how your account signs in; ' +
    'your workspace opens once you sign in normally again.',
  devicesSignedOut:
    'Your account was recovered on this device, so every other device was signed out. ' +
    'Sign in on them again once you have finished here.',
  begin: 'Continue',
  tasksTitle: 'What do you need to fix?',
  tasksBody: 'Do as many as you need, in any order. Each change takes effect at once.',
  finishTitle: 'All set',
  finishSignedIn: 'Your new password works now. Continue to sign in with it and open your workspace.',
  finishSignOut: 'Sign out now, then sign in with the way you just set up.',
  continueSignedIn: 'Continue to my workspace',
  signOut: 'Sign out',
  done: 'Finish',
  back: 'Back to the list',
  newPassword: 'New password',
  confirmPassword: 'Type it again',
  passwordMismatch: "The two passwords don't match.",
  savePassword: 'Set password',
  credentialsEmpty: 'No sign-in methods are listed for this account.',
  remove: 'Remove',
  savePolicy: 'Save',
} as const;

export const TASK_COPY: Record<'password' | 'key' | 'credentials' | 'policy' | 'phrase', { title: string; detail: string }> = {
  password: { title: 'Set a new password', detail: 'Replaces the one you forgot. No old password needed.' },
  key: { title: 'Add a security key', detail: 'Touch ID, your phone or a hardware key.' },
  credentials: { title: 'Review sign-in methods', detail: 'See every password, key and phrase, and remove a lost one.' },
  policy: { title: 'Change how you sign in', detail: 'Password, password and key, or key only.' },
  phrase: { title: 'Make a new recovery phrase', detail: 'Do this if anyone else may have seen the old one.' },
};
