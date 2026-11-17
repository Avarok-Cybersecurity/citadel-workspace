/**
 * Who a session is, from the agent's answer to `GetAccountInformation`.
 *
 * The UI asked this question and never read the answer: nothing handled
 * `GetAccountInformationResponse`, so the "Loading..." placeholder set beside the request
 * stayed for the life of the tab (seen live: the leader tab's account menu read "Account
 * menu for Loading..." after another tab reopened a session). Pure: the request/response
 * plumbing lives in user-service.
 */
export interface AccountIdentity {
  username: string;
  fullName: string;
}

type Accounts = Map<unknown, unknown> | Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The agent's map of accounts: a JS Map from the WASM client (bigint keys), or an object. */
function accountFor(accounts: Accounts, cid: bigint): unknown {
  if (accounts instanceof Map) {
    for (const [key, value] of accounts) if (String(key) === cid.toString()) return value;
    return undefined;
  }
  return accounts[cid.toString()];
}

export function readAccountIdentity(message: unknown, requestId: string, cid: bigint): AccountIdentity | undefined {
  const unwrapped: unknown = isRecord(message) && isRecord(message.Response) ? message.Response : message;
  if (!isRecord(unwrapped)) return undefined;
  const body: unknown = unwrapped.GetAccountInformationResponse;
  if (!isRecord(body) || body.request_id !== requestId) return undefined;
  const accounts: unknown = body.accounts;
  if (!(accounts instanceof Map) && !isRecord(accounts)) return undefined;
  const account: unknown = accountFor(accounts, cid);
  if (!isRecord(account) || typeof account.username !== 'string') return undefined;
  const fullName: string = typeof account.full_name === 'string' && account.full_name.length > 0 ? account.full_name : account.username;
  return { username: account.username, fullName };
}
