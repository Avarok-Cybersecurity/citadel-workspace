/**
 * What the page says for each way a sign-in can stop. Keys are the issuer's reason codes
 * (sign-in-with-citadel.md §1a; control/sign-in-issuer.mjs, server-wasm `reason`), the agent's
 * `IdentityRefusal` names (snake_case on the wire), and the page's own.
 */

export interface Explanation {
  title: string;
  body: string;
}

const START_AGAIN: string = 'Go back to the app that sent you here and start the sign-in again.';
const NOT_SIGNED: string = 'Nothing was signed in. ';

export const EXPLANATIONS: Readonly<Record<string, Explanation>> = {
  // The link (refused by the page before anything is asked, or by the issuer at begin).
  malformed_link: { title: 'This sign-in link is not valid', body: `The link is incomplete or has been changed. ${START_AGAIN}` },
  unknown_client: { title: 'This app is not registered', body: 'The app that sent you here is not one Citadel signs in to. Nothing was shared with it.' },
  return_not_allowlisted: { title: 'This link returns somewhere it should not', body: 'The address this link would send your sign-in to is not one registered for that app, so Citadel will not sign you in through it.' },
  // The issuer, before an attempt exists.
  unreachable: { title: 'The sign-in server did not answer', body: 'Check your connection and reload this page.' },
  issuer_unavailable: { title: 'Sign-in is not available right now', body: 'The sign-in server cannot sign anyone in at the moment. Try again later.' },
  'cross-origin': { title: 'Sign-in is not available on this site', body: 'Sign in with Citadel works only at work.avarok.net.' },
  'too-large': { title: 'The sign-in server refused the request', body: `The request was larger than it accepts. ${START_AGAIN}` },
  'malformed-request': { title: 'The sign-in server refused the request', body: `It did not understand what this page sent. Reload the page and try again.` },
  unexpected_answer: { title: 'Something answered unexpectedly', body: `${NOT_SIGNED}An answer did not have the shape this page expects. Reload the page and try again.` },
  // The issuer, at prove.
  unknown_attempt: { title: 'This sign-in attempt is no longer known', body: `${NOT_SIGNED}It may have been stopped after too many failures. Start again to make a new one.` },
  attempt_expired: { title: 'This sign-in took too long', body: `${NOT_SIGNED}An attempt lasts five minutes. Start again to make a new one.` },
  attempt_proven: { title: 'This sign-in attempt was already used', body: `${NOT_SIGNED}Each attempt can be approved once. Start again to make a new one.` },
  malformed_proof: { title: 'Your agent sent a proof the server could not read', body: `${NOT_SIGNED}Update the Citadel Agent and try again.` },
  bad_signature: { title: 'The proof from your agent did not verify', body: `${NOT_SIGNED}Update the Citadel Agent and try again.` },
  wrong_issuer: { title: 'The proof names a different sign-in server', body: `${NOT_SIGNED}Your agent signed for another server than this one.` },
  wrong_origin: { title: 'The proof came from a different website', body: `${NOT_SIGNED}Your agent saw this request coming from a site other than work.avarok.net. Close this tab and open the sign-in link again.` },
  audience_mismatch: { title: 'The proof is for a different app', body: `${NOT_SIGNED}${START_AGAIN}` },
  nonce_mismatch: { title: 'The proof is for a different attempt', body: `${NOT_SIGNED}${START_AGAIN}` },
  challenge_mismatch: { title: 'The proof is for a different sign-in link', body: `${NOT_SIGNED}${START_AGAIN}` },
  // The page, after prove.
  return_mismatch: { title: 'The sign-in server answered for a different link', body: `${NOT_SIGNED}Your code was not sent anywhere. ${START_AGAIN}` },
  // The agent.
  agent_lost: { title: 'The connection to the Citadel Agent was lost', body: 'Make sure the agent is running, then start again.' },
  no_browser_origin: { title: 'The agent could not tell which site asked', body: `${NOT_SIGNED}Reload this page and try again.` },
  bad_field: { title: 'The agent refused the request', body: `${NOT_SIGNED}One of its fields was out of bounds. ${START_AGAIN}` },
  not_configured: { title: 'This Citadel Agent cannot hold an identity', body: 'It was started without an identity store. Install the current Citadel Agent and try again.' },
  storage: { title: 'The agent could not read or save your identity', body: 'Check that the agent can write to its data folder, then try again.' },
  already_exists: { title: 'This agent already holds an identity', body: 'Reload this page to sign in with it.' },
  no_identity: { title: 'This agent holds no identity', body: 'Reload this page to create one.' },
  // In the consent dialog.
  wrong_password: { title: 'Wrong password', body: 'That password does not unlock your identity. Try again.' },
  rate_limited: { title: 'Too many tries', body: 'Wait a minute, then try your password again.' },
};

/** The explanation for `code`; an unlisted one still says it was refused, and names the code. */
export function explain(code: string): Explanation {
  return Object.hasOwn(EXPLANATIONS, code)
    ? EXPLANATIONS[code]
    : { title: 'The sign-in was refused', body: `${NOT_SIGNED}The reason given was "${code}".` };
}
