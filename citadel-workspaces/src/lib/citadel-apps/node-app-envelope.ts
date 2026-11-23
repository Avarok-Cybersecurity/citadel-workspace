/**
 * The `citadel_app` envelope of a node's metadata, read exactly as node-page-abi.md §2 and
 * `node-page-envelope.schema.json` state it: v1 names a first-party document app (docs, pdf,
 * latex) and is read as it always was; v2 names an installed app's page, `{ app, install_id }`,
 * where `app` follows the `citadel-app-id` grammar and is never a v1 id. Both levels deny unknown
 * fields. Anything else is `unreadable` with a reason a person can read: a refusal, never a
 * default. Pure: whether the install exists and still offers a page is decided where the install
 * registry is known (AppNodePage), not here.
 */
import { isAppId } from './app-identity';
import { isCitadelAppId, type CitadelAppId } from './registry';

export const NODE_APP_KIND: 'citadel-app' = 'citadel-app';
export const NODE_APP_DOCUMENT_VERSION: 1 = 1;
export const NODE_APP_PAGE_VERSION: 2 = 2;

/** An installed app's page: the app and the install the node is bound to. */
export interface NodeAppPage {
  readonly app: string;
  readonly installId: string;
}

export type NodeAppBinding =
  | { readonly kind: 'none' }
  | { readonly kind: 'document'; readonly app: CitadelAppId }
  | { readonly kind: 'installed'; readonly app: string; readonly installId: string }
  | { readonly kind: 'unreadable'; readonly reason: string };

export type ReadBinding = Exclude<NodeAppBinding, { kind: 'none' }>;

const INSTALL_ID: RegExp = /^[\x21-\x7e]{1,128}$/;

/** The kernel's opaque install id, as the envelope carries it: 1 to 128 printable ASCII characters. */
export function isInstallId(value: unknown): value is string {
  return typeof value === 'string' && INSTALL_ID.test(value);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const refuse = (reason: string): ReadBinding => ({ kind: 'unreadable', reason });

/** The first field `value` has beyond `known`, or the first of `known` it lacks; null when exact. */
function fieldProblem(value: Record<string, unknown>, known: readonly string[], part: 'record' | 'record’s payload'): string | null {
  const extra: string | undefined = Object.keys(value).find((k: string): boolean => !known.includes(k));
  if (extra !== undefined) return `This node's app ${part} has a field this version of Citadel does not read: “${extra}”.`;
  const missing: string | undefined = known.find((k: string): boolean => !Object.hasOwn(value, k));
  return missing === undefined ? null : `This node's app ${part} has no “${missing}”.`;
}

function readDocument(payload: Record<string, unknown>): ReadBinding {
  const problem: string | null = fieldProblem(payload, ['app'], 'record’s payload');
  if (problem !== null) return refuse(problem);
  return isCitadelAppId(payload.app)
    ? { kind: 'document', app: payload.app }
    : refuse(`This node names an app this version of Citadel does not know: ${String(payload.app)}.`);
}

function readPage(payload: Record<string, unknown>): ReadBinding {
  const problem: string | null = fieldProblem(payload, ['app', 'install_id'], 'record’s payload');
  if (problem !== null) return refuse(problem);
  const { app, install_id: installId } = payload;
  if (isCitadelAppId(app)) return refuse(`This node's page names “${app}”, which is a Citadel document app, not an installed app.`);
  if (typeof app !== 'string' || !isAppId(app)) return refuse(`This node's page names “${String(app)}”, which is not an app id.`);
  if (!isInstallId(installId)) return refuse('This node\'s page names no install it could open.');
  return { kind: 'installed', app, installId };
}

/** The value under `citadel_app`, read; never throws. */
export function readNodeAppEnvelope(envelope: unknown): ReadBinding {
  if (!isRecord(envelope)) return refuse('This node\'s app record is not an object.');
  const problem: string | null = fieldProblem(envelope, ['v', 'kind', 'payload'], 'record');
  if (problem !== null) return refuse(problem);
  const { v, kind, payload } = envelope;
  if (v !== NODE_APP_DOCUMENT_VERSION && v !== NODE_APP_PAGE_VERSION) {
    return refuse(`This node's app record is version ${String(v)}; this version of Citadel reads versions ${NODE_APP_DOCUMENT_VERSION} and ${NODE_APP_PAGE_VERSION}.`);
  }
  if (kind !== NODE_APP_KIND) return refuse(`This node's app record has kind ${String(kind)}.`);
  if (!isRecord(payload)) return refuse('This node\'s app record has no payload object.');
  return v === NODE_APP_DOCUMENT_VERSION ? readDocument(payload) : readPage(payload);
}
