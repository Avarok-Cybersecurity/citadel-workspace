/**
 * Every sentence the passkey UI says, in one place (docs/plans/passkey-login.md
 * section 3.6).
 */
export const PASSKEY_COPY: {
  readonly signInButton: 'Use passkey or security key';
  readonly orPassword: 'or use your password';
  readonly enrolSwitch: 'Add a security key after I sign in';
  readonly addButton: 'Add a passkey or security key';
  readonly sectionTitle: 'Sign-in keys';
  readonly pinNote: string;
  readonly unavailableHere: string;
  readonly chooseAccount: 'Sign in with a passkey as:';
  readonly serverUnknown: 'server not recorded on this device';
} = {
  signInButton: 'Use passkey or security key',
  orPassword: 'or use your password',
  enrolSwitch: 'Add a security key after I sign in',
  addButton: 'Add a passkey or security key',
  sectionTitle: 'Sign-in keys',
  pinNote: 'Security keys need a PIN set first — we require it so a lost key can\'t be used on its own.',
  unavailableHere: 'Passkeys need a secure (https or localhost) page in a browser that supports them. Your password still works.',
  chooseAccount: 'Sign in with a passkey as:',
  serverUnknown: 'server not recorded on this device',
} as const;

export const removeCopy = (label: string): string =>
  `Remove ${label}? It will no longer sign you in. ` +
  'It may still appear in your passkey list; you can delete it there too.';
