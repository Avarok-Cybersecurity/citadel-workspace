/**
 * What the user is told after a connection request goes out.
 *
 * "They will receive it when online" was said to every peer, including one the
 * discovery list showed as Online a line above -- telling the user to wait for
 * something that had already happened. The note belongs only where it is true:
 * the peer is offline, or the agent has not said (`null`).
 */
export function connectionRequestSentCopy(peerName: string, isOnline: boolean | null): string {
  return isOnline === true
    ? `Connection request sent to ${peerName}.`
    : `Connection request sent to ${peerName}. They will receive it when online.`;
}
