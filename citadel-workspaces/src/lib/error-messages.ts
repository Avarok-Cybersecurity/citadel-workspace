import { describeError } from './describe-error';
import { readableSdkError } from './sdk-error-text';
import { SERVER_HOLDS_A_SESSION } from './server-session-copy';
import { credentialErrorMessage } from './credential-error-messages';
import { workspaceMasterPasswordError, isWrongMasterPassword, WRONG_MASTER_PASSWORD_TITLE } from './workspace-master-password-error';
/**
 * Transforms technical error messages into user-friendly messages
 */
/**
 * `unknown`, not `string | Error`.
 *
 * Three call sites — login, registration and workspace initialization, which
 * is every flow a new user meets — narrowed with
 * `err instanceof Error ? err : String(err)` before calling this. `String()`
 * on a structured rejection is `[object Object]`, and the revfs and websocket
 * layers both reject with one. That string then matches none of the branches
 * below, is not protocol jargon and is under 200 characters, so it reached the
 * user through the passthrough as:
 *
 *   Something went wrong: [object Object]
 *
 * Taking `unknown` and normalising here removes the coercion from all three at
 * once, rather than asking each to remember.
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
  const errorMessage: string = readableSdkError(describeError(error));
  
  // Connection-related errors
  if (errorMessage.includes('WebSocket connection failed') || 
      errorMessage.includes('Failed to initialize WASM client')) {
    // Not "check your internet connection". This socket is SAME-ORIGIN /ws,
    // proxied to the internal service — the local agent that owns protocol
    // connections. When it fails, the usual cause is that the agent is not
    // running or is restarting, and a user who goes off to check their wifi is
    // being sent somewhere that cannot help.
    //
    // Genuine loss of network is already covered, and better: OfflineBanner
    // watches navigator.onLine, and WorkspaceApp suppresses the retry modal
    // while offline so the two never both fire. That left this string handling
    // only the case its advice did not fit.
    return 'Unable to reach the Citadel agent on this machine. It may not be running yet, or may be restarting — try again in a moment.';
  }
  
  if (errorMessage.includes('Connection closed before receiving a handshake')) {
    return 'The workspace server is not responding. It may be restarting. Please try again in a moment.';
  }
  
  // The workspace server's refusal, not another window here: see server-session-copy.ts.
  if (errorMessage.includes('Session Already Connected') || errorMessage.includes('already connected')) return SERVER_HOLDS_A_SESSION;
  
  // Registration specifically. The generic branch below says "check your
  // network", which is wrong for almost every real instance of this: the agent
  // runs on this machine and the page reached it fine, so what timed out is the
  // agent's attempt to reach the WORKSPACE SERVER at the address just typed.
  // Telling someone to check their network sends them to the one place the
  // fault is not. work.avarok.net showed this exact message to every new user
  // for weeks while the real cause was a refused DNS lookup in the page.
  if (/registration timed out|deadline has elapsed/i.test(errorMessage)) {
    return 'The workspace server did not answer within 30 seconds. Check the address you entered — a host name or IP address, like citadel.example.com, optionally followed by a colon and a port. If that is right, the server may be down or unreachable from this machine.';
  }

  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return 'The connection request timed out. Please check your network and try again.';
  }
  
  // Authentication errors
  if (errorMessage.includes('Invalid credentials') || 
      errorMessage.includes('Authentication failed')) {
    return 'Invalid username or password. Please check your credentials and try again.';
  }
  
  if (errorMessage.includes('User not found')) {
    return 'No account found with that username. Please check your username or create a new account.';
  }
  
  // The SDK's actual message is `Username <name> already exists!`, captured
  // from the live toast. The previous literal 'User already exists' never
  // matched it, so the single most ordinary registration failure — picking a
  // name someone already has — fell through to the raw
  // "Something went wrong: Username bob already exists!" fallback.
  if (/already exists/i.test(errorMessage) && /user/i.test(errorMessage)) {
    return 'An account with that username already exists. Please choose a different username.';
  }
  
  // Workspace errors
  if (errorMessage.includes('Workspace not found')) {
    return 'The workspace could not be found. Please check the workspace address.';
  }
  
  if (errorMessage.includes('Workspace initialization failed')) {
    return 'Failed to initialize the workspace. Please check your workspace password.';
  }
  
  // The master password the first administrator is asked for, in the position
  // its predecessor occupied -- which matched a wording the server never sends.
  // See workspace-master-password-error.ts for the two it does.
  const masterPassword: string | null = workspaceMasterPasswordError(errorMessage);
  if (masterPassword !== null) return masterPassword;
  
  // Network errors
  if (errorMessage.includes('NetworkError when attempting to fetch') || 
      errorMessage.includes('ERR_NETWORK')) {
    return 'Network error. Please check your internet connection.';
  }
  
  if (errorMessage.includes('CORS')) {
    return 'Connection blocked by security settings. Please contact your administrator.';
  }
  
  // Account/password errors, matched case-insensitively.
  //
  // These were all-lowercase `.includes()` needles, and `.includes()` is
  // case-sensitive — while the SDK emits `#[form = "Invalid password"]` with a
  // capital I (citadel_io/src/error/code.rs). So the branch handling the
  // product's single most common error could never fire, and a mistyped
  // password fell through to "Something went wrong: Invalid password".
  //
  // Exactly the bug documented above for 'User already exists', which was
  // fixed with a case-insensitive regex. Same remedy here.
  // The credential and account-existence branches, in the position they have
  // always occupied. See credential-error-messages.ts -- they moved together
  // because they fail together, not merely to satisfy a line limit.
  const credentials: string | null = credentialErrorMessage(errorMessage);
  if (credentials !== null) return credentials;

  // A mistyped server address, which is the likeliest mistake a new visitor
  // makes and the first thing they do.
  //
  // The agent resolves the address itself (the browser has no DNS API, and the
  // page's CSP forbids the DNS-over-HTTPS call the UI once used), and answers a
  // failure with one of two strings from
  // citadel-internal-service/src/kernel/requests/register.rs:
  //
  //   could not resolve {server_addr}: {err}
  //   {server_addr} resolved to no addresses
  //
  // Neither had a branch here, so the raw one reached the screen:
  //
  //   Something went wrong: could not resolve no-such-host.avarok.net:12400:
  //   failed to lookup address information: nodename nor servname provided, or
  //   not known
  //
  // That is a getaddrinfo string shown to somebody on their first attempt to
  // join. The two neighbouring mistakes -- a host with nothing listening, and a
  // missing port -- both already produce a sentence a person can act on; this
  // one did not, and it is the one they are most likely to hit.
  if (/could not resolve|resolved to no addresses/i.test(errorMessage)) {
    return (
      'No server was found at that address. Check it for typos — a host name or IP ' +
      'address, like citadel.example.com, optionally followed by a colon and a port.'
    );
  }

  if (errorMessage.includes('Connection refused') || 
      errorMessage.includes('ECONNREFUSED')) {
    return 'Could not reach the server. Please check the server address and ensure the server is running.';
  }

  if (errorMessage.includes('connect failed') || 
      errorMessage.includes('Connection failed')) {
    return 'Failed to connect to the workspace server. Please verify your credentials and server address.';
  }

  // Generic errors
  if (errorMessage.includes('Internal server error')) {
    return 'The server encountered an error. Please try again later.';
  }
  
  if (errorMessage.includes('Service unavailable')) {
    return 'The service is temporarily unavailable. Please try again in a few minutes.';
  }
  
  // Unmatched text is passed through, because a generic sentence hides the one
  // clue anybody has. What it must NOT pass through is protocol vocabulary: the
  // words below are the transport's, and to a user they read as the app
  // speaking a language it never taught them.
  // ANCHORED. Unanchored, this stripped "error:" from the MIDDLE of a message:
  // the SDK's "Socket error: deadline has elapsed" was shown to users as
  // "Socket deadline has elapsed" -- a sentence that never existed anywhere.
  // That cost real time: matchers written from the rendered text could never
  // match the input, because the rendered text was already mangled. Only the
  // leading "Error:" of a stringified Error is noise; an "error:" inside the
  // sentence is the message.
  const cleanedMessage: string = errorMessage
    .replace(/^Error:\s*/i, '')
    .replace(/^\s+|\s+$/g, '');

  const isProtocolJargon: boolean =
    /\b(ratchet|handshake|ILM|CID|toolset|packet|codec|serde|deserializ|kem|psk)\b/i.test(
      cleanedMessage,
    );

  if (cleanedMessage && cleanedMessage.length < 200 && !isProtocolJargon) {
    return `Something went wrong: ${cleanedMessage}`;
  }
  return 'An unexpected error occurred. Please try again or contact support if the problem persists.';
}

/**
 * Gets a user-friendly title for an error
 */
export function getErrorTitle(error: unknown): string {
  const errorMessage: string = readableSdkError(describeError(error));

  // First, because two later branches would each claim it: the string holds
  // "password" (Authentication Error) and "workspace" (Workspace Error), and
  // "Authentication" points at the account they just created successfully.
  if (isWrongMasterPassword(errorMessage)) return WRONG_MASTER_PASSWORD_TITLE;

  if (errorMessage.includes('connection') || errorMessage.includes('WebSocket') ||
      errorMessage.includes('Connection') || errorMessage.includes('ECONNREFUSED')) {
    return 'Connection Error';
  }
  
  if (errorMessage.includes('authentication') || errorMessage.includes('credentials') ||
      errorMessage.includes('password') || errorMessage.includes('Password')) {
    return 'Authentication Error';
  }
  
  if (errorMessage.includes('workspace') || errorMessage.includes('Workspace')) {
    return 'Workspace Error';
  }
  
  if (errorMessage.includes('network') || errorMessage.includes('Network')) {
    return 'Network Error';
  }
  
  // Before the generic timeout title: "Request Timeout" describes the client's
  // clock, not what happened. The server is the thing that did not answer.
  if (/registration timed out|deadline has elapsed/i.test(errorMessage)) {
    return 'Server Did Not Answer';
  }

  if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
    return 'Request Timeout';
  }

  // Checked before the generic fallback so the commonest registration failure
  // gets a title that says what happened. Previously it rendered as a bare
  // "Error" over the raw server string.
  if (/already exists/i.test(errorMessage) && /user/i.test(errorMessage)) {
    return 'Username Taken';
  }

  if (errorMessage.includes('not found') || errorMessage.includes('not exist') ||
      errorMessage.includes('not registered')) {
    return 'Account Not Found';
  }
  
  return 'Error';
}