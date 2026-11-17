/**
 * What sign-in says when the workspace server refuses because it still holds
 * a session for the account.
 *
 * The refusal is the SDK's preconnect: "Session Already Connected, or, is in
 * the process of disconnection...". It means the SERVER still has a session for
 * this account -- most often one that dropped without signing out -- not that
 * another window here has it: a session live on this agent is answered
 * SessionAlreadyActive and claimed instead. The old copy said "You are already
 * connected in another window or tab. Would you like to take over this
 * session?" with no window to find and no takeover on offer.
 */
export const SERVER_HOLDS_A_SESSION: string =
  'The workspace server still has this account signed in, usually from a connection that dropped ' +
  'without signing out. It lets go of it shortly: try again in a minute. If the account is open on ' +
  'another device, sign out there first.';
