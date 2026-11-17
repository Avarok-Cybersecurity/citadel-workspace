import type { JoinFormData } from './useJoinRegistration';

/** An untouched Profile step. One definition, for the step and for the draft kept above it. */
export const BLANK_JOIN_FORM: JoinFormData = Object.freeze({
  fullName: '',
  username: '',
  password: '',
  confirmPassword: '',
  avatarData: null,
  email: '',
  title: '',
  // Off until ticked: the Terms are required to Join, diagnostics are never assumed.
  termsAccepted: false,
  shareDiagnostics: false,
});
