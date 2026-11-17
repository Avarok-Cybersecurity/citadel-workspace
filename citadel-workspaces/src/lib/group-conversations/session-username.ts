/**
 * The signed-in account's username, read when a group message arrives.
 *
 * Handed to the group bindings rather than imported by them: an office channel names the sender
 * by username, so the store and the bell need it to recognise your own message, but importing
 * the connection manager into those rule modules pulled the whole session stack (and a live
 * BroadcastChannel) into every test of them, and into the response handler it made an import
 * cycle. The hook that starts the bindings passes this in.
 */
import { connectionManager } from '@/lib/connection';

export function sessionUsername(): string | undefined {
  return connectionManager.getConnectionInfo()?.username;
}
