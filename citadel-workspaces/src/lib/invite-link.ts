/**
 * The link an invite hands over: it opens the join wizard with the server filled in.
 *
 * Written by the invite dialog, read by Landing. One module, so the parameter
 * name cannot drift between the two ends.
 */

const SERVER_PARAM: string = 'server';
/** A host name is at most 253 characters; with ":port" that is 259. */
const MAX_ADDRESS_LENGTH: number = 259;

export function inviteLink(origin: string, serverAddress: string): string {
  const params: URLSearchParams = new URLSearchParams({ join: '1', [SERVER_PARAM]: serverAddress });
  return `${origin}/?${params.toString()}`;
}

/**
 * The server a join link names, or null when it names none that could be one.
 * Only ever PRE-FILLS the address field -- the person still reads and submits it.
 */
export function joinServerFrom(params: URLSearchParams): string | null {
  const value: string = (params.get(SERVER_PARAM) ?? '').trim();
  if (!value || value.length > MAX_ADDRESS_LENGTH || /\s/.test(value)) return null;
  return value;
}

/** Remove the join link's parameters once consumed, so back/forward and reload stay clean. */
export function withoutJoinParams(params: URLSearchParams): URLSearchParams {
  const next: URLSearchParams = new URLSearchParams(params);
  next.delete('join');
  next.delete(SERVER_PARAM);
  return next;
}
