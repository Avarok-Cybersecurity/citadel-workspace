/**
 * The Telemetry service's requests on the workspace protocol: terms, consent, the admin's log
 * viewer and policy. Each request resolves with what the SERVER answers (`WorkspaceProtocolResponse::
 * Telemetry`), matched by the answer's kind, and rejects with the server's refusal.
 */
import type {
  CurrentTerms, MyConsent, TelemetryAccessLogEntry, TelemetryFilter, TelemetryPage, TelemetryPageResult,
  TelemetryRequest, TelemetrySettings,
} from 'citadel-workspace-client-ts';
import { awaitWriteResponse } from './await-write-response';
import type { ProtocolSender } from './workspace-operations';

type Answers = {
  Terms: CurrentTerms;
  Consent: MyConsent;
  Page: TelemetryPageResult;
  Settings: TelemetrySettings;
  AccessLog: TelemetryAccessLogEntry[];
  Deleted: { segments: number };
};

/** The answer's kind, when `payload` is a telemetry answer of kind `key`. */
export function answerOf<K extends keyof Answers>(payload: unknown, key: K): Answers[K] | null {
  if (!payload || typeof payload !== 'object' || !(key in payload)) return null;
  return (payload as { [P in K]: Answers[P] })[key];
}

/**
 * `reflects` is for requests that change something. The agent also asks `GetMyConsent` on its own
 * and the server's answer reaches this tab too; the protocol has no request id, so a `Consent` is
 * taken for ours unless it shows our change. One that does not is somebody else's and is skipped.
 */
async function exchange<K extends keyof Answers>(
  sender: ProtocolSender, request: TelemetryRequest, key: K, reflects: (answer: Answers[K]) => boolean = (): boolean => true,
): Promise<Answers[K]> {
  let answered: Answers[K] | null = null;
  await awaitWriteResponse('Telemetry', () => sender.sendProtocolRequest({ Telemetry: request }), (payload: unknown): boolean => {
    const candidate: Answers[K] | null = answerOf(payload, key);
    if (candidate === null || !reflects(candidate)) return false;
    answered = candidate;
    return true;
  });
  if (answered === null) throw new Error('Telemetry: the server\'s answer did not carry what was asked for');
  return answered;
}

export const getTerms = (s: ProtocolSender): Promise<CurrentTerms> => exchange(s, 'GetTerms', 'Terms');
export const getMyConsent = (s: ProtocolSender): Promise<MyConsent> => exchange(s, 'GetMyConsent', 'Consent');
export const acceptTerms = (s: ProtocolSender, platformVersion: number, workspaceVersion: number | null): Promise<MyConsent> =>
  exchange(s, { AcceptTerms: { platform_version: platformVersion, workspace_version: workspaceVersion } }, 'Consent',
    (answer: MyConsent): boolean => answer.terms_current);
export const setTelemetryConsent = (s: ProtocolSender, enabled: boolean): Promise<MyConsent> =>
  exchange(s, { SetTelemetryConsent: { enabled } }, 'Consent',
    (answer: MyConsent): boolean => answer.telemetry_enabled === enabled);
export const deleteMyTelemetry = async (s: ProtocolSender): Promise<number> => (await exchange(s, 'DeleteMyTelemetry', 'Deleted')).segments;
export const listTelemetry = (s: ProtocolSender, filter: TelemetryFilter, page: TelemetryPage): Promise<TelemetryPageResult> =>
  exchange(s, { ListTelemetry: { filter, page } }, 'Page');
export const getTelemetrySettings = (s: ProtocolSender): Promise<TelemetrySettings> => exchange(s, 'GetTelemetrySettings', 'Settings');
export const setTelemetryPolicy = (s: ProtocolSender, retentionDays: number, perUserBytes: bigint): Promise<TelemetrySettings> =>
  exchange(s, { SetTelemetryPolicy: { retention_days: retentionDays, per_user_bytes: perUserBytes } }, 'Settings');
export const setSupportAccess = (s: ProtocolSender, enabled: boolean, untilMs: bigint | null): Promise<TelemetrySettings> =>
  exchange(s, { SetSupportAccess: { enabled, until_ms: untilMs } }, 'Settings');
export const listTelemetryAccessLog = (s: ProtocolSender): Promise<TelemetryAccessLogEntry[]> => exchange(s, 'ListTelemetryAccessLog', 'AccessLog');
export const setWorkspaceTerms = (s: ProtocolSender, text: string | null): Promise<CurrentTerms> =>
  exchange(s, { SetWorkspaceTerms: { text } }, 'Terms');
