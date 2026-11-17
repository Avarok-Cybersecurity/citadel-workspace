/**
 * The telemetry requests bound to this tab's workspace session. Components and hooks import this
 * rather than the sender-taking operations, so a test replaces the one I/O boundary.
 */
import WorkspaceService from '@/lib/workspace-service';
import * as ops from '@/lib/workspace-service/telemetry-operations';

/** An operation with its first argument, the session's sender, already supplied. */
type Bound<F> = F extends (sender: never, ...rest: infer A) => infer R ? (...args: A) => R : never;

/** Each signature is the operation's own, so the two cannot drift. */
export interface TelemetryApi {
  getTerms: Bound<typeof ops.getTerms>;
  getMyConsent: Bound<typeof ops.getMyConsent>;
  acceptTerms: Bound<typeof ops.acceptTerms>;
  setConsent: Bound<typeof ops.setTelemetryConsent>;
  deleteMine: Bound<typeof ops.deleteMyTelemetry>;
  list: Bound<typeof ops.listTelemetry>;
  getSettings: Bound<typeof ops.getTelemetrySettings>;
  setPolicy: Bound<typeof ops.setTelemetryPolicy>;
  setSupportAccess: Bound<typeof ops.setSupportAccess>;
  accessLog: Bound<typeof ops.listTelemetryAccessLog>;
  setWorkspaceTerms: Bound<typeof ops.setWorkspaceTerms>;
}

export const telemetryApi: TelemetryApi = {
  getTerms: () => ops.getTerms(WorkspaceService),
  getMyConsent: () => ops.getMyConsent(WorkspaceService),
  acceptTerms: (platformVersion: number, workspaceVersion: number | null) => ops.acceptTerms(WorkspaceService, platformVersion, workspaceVersion),
  setConsent: (enabled: boolean) => ops.setTelemetryConsent(WorkspaceService, enabled),
  deleteMine: () => ops.deleteMyTelemetry(WorkspaceService),
  list: (...args: [Parameters<typeof ops.listTelemetry>[1], Parameters<typeof ops.listTelemetry>[2]]) => ops.listTelemetry(WorkspaceService, ...args),
  getSettings: () => ops.getTelemetrySettings(WorkspaceService),
  setPolicy: (retentionDays: number, perUserBytes: bigint) => ops.setTelemetryPolicy(WorkspaceService, retentionDays, perUserBytes),
  setSupportAccess: (enabled: boolean, untilMs: bigint | null) => ops.setSupportAccess(WorkspaceService, enabled, untilMs),
  accessLog: () => ops.listTelemetryAccessLog(WorkspaceService),
  setWorkspaceTerms: (text: string | null) => ops.setWorkspaceTerms(WorkspaceService, text),
};
