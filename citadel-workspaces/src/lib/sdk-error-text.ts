/**
 * The sentence inside an SDK error the agent forwarded in its Debug form.
 *
 * Some agent paths pass a Citadel SDK error through `{:?}`, which renders as
 *
 *   Unable to proceed past session zero-state. Stopping session: NetworkError {
 *   code: SessionSecurityExceedsRegistration (169), origin: "…/session.rs:912",
 *   message: "The session security level Extreme exceeds this account's
 *   registered level Standard. Log in at Standard or lower, …" }
 *
 * The SDK's error type is named `NetworkError`, and error-messages.ts mapped any
 * text containing that word to "Network error. Please check your internet
 * connection." So signing in at a security level above the account's
 * registered one -- an ordinary choice on the login form -- told the user their
 * internet was down, while the SDK had written exactly what to do instead.
 *
 * Returns the SDK's `message` when the text carries that structure, and the
 * text unchanged otherwise.
 */
const SDK_DEBUG_MESSAGE: RegExp = /NetworkError \{ code: [^]*?message: "((?:[^"\\]|\\.)*)" \}/;

export function readableSdkError(text: string): string {
  const found: RegExpExecArray | null = SDK_DEBUG_MESSAGE.exec(text);
  if (found === null) return text;
  return found[1].replace(/\\(["\\])/g, '$1');
}
