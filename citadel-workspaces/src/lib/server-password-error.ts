/**
 * The failure a registration gets when its server password is not the server's.
 *
 * That field is the Citadel protocol's pre-shared key for the connection (see
 * auth-operations.ts), and a key the server does not hold surfaces from the SDK's
 * handshake as "Rekey update error: Encryption failure" -- measured live, when a new
 * owner pasted their claim code into it. A claim code or workspace master password is
 * asked for after joining, by the initialization dialog; this field is almost always
 * left blank.
 *
 * Only when a server password was actually sent: without one, the same words mean a
 * real handshake fault, and claiming otherwise would send the person after a field
 * they never filled.
 */
const HANDSHAKE_DECRYPT_FAILURE: RegExp = /rekey update error|encryption failure/i;

export function serverPasswordMismatchMessage(errorMessage: string, sentServerPassword: boolean): string | null {
  if (!sentServerPassword || !HANDSHAKE_DECRYPT_FAILURE.test(errorMessage)) return null;
  return 'The server password did not match this server. Leave it blank unless the server\'s operator gave you one — a claim code or master password is not entered there; you are asked for it after joining.';
}
