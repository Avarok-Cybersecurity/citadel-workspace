/**
 * The manifest's shape, as serde reads it before any rule: every object holds exactly its fields
 * (`deny_unknown_fields`), every enum one of its names, every number an integer in its type's
 * range. Anything else is the `Json` refusal, as in Rust.
 */
import type { AppCategory, AppSurface, ScopeKind } from 'citadel-workspace-client-ts';
import { CAPABILITIES } from '../host/capabilities';

export const CATEGORIES: readonly AppCategory[] = ['planning', 'productivity', 'communication', 'documents', 'files', 'developer', 'design', 'data', 'integrations', 'utilities'];
export const SURFACES: readonly AppSurface[] = ['canvas_pane', 'md_zone', 'node_tab'];
export const SCOPE_KINDS: readonly ScopeKind[] = ['workspace', 'node', 'node_tree', 'users', 'self'];
/** The scopes whose install everyone on some node sees, which a node tab needs (`ScopeKind::reaches_a_node` in Rust). */
export const NODE_REACHING_SCOPES: readonly ScopeKind[] = ['workspace', 'node', 'node_tree'];
/** The SDK's closed list (generated from citadel-app-sdk-types), which the Rust manifest reads too. */
export { CAPABILITIES };
const U32_MAX: number = 4_294_967_295;

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isU32 = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= U32_MAX;
const isU64 = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isBool = (v: unknown): boolean => typeof v === 'boolean';
const listOf = (v: unknown, item: (x: unknown) => boolean): boolean => Array.isArray(v) && v.every(item);
const oneOf = <T extends string>(names: readonly T[]) => (v: unknown): boolean => isString(v) && (names as readonly string[]).includes(v);

/** Exactly these fields, each of its type; an optional one may be absent or null (serde's `None`). */
function fields(v: unknown, required: Record<string, (x: unknown) => boolean>, optional: Record<string, (x: unknown) => boolean> = {}): boolean {
  if (!isObject(v)) return false;
  const keys: string[] = Object.keys(v);
  if (keys.some((k: string) => !(k in required) && !(k in optional))) return false;
  return Object.entries(required).every(([k, ok]) => k in v && ok(v[k]))
    && Object.entries(optional).every(([k, ok]) => !(k in v) || v[k] === null || ok(v[k]));
}

function audienceShape(v: unknown): boolean {
  if (!isObject(v) || !isString(v.kind)) return false;
  const strings = (x: unknown): boolean => listOf(x, isString);
  const kind = (rest: Record<string, (x: unknown) => boolean>): boolean => fields(v, { kind: isString, ...rest });
  switch (v.kind) {
    case 'global': case 'workspace': return kind({});
    case 'node_viewers': case 'node_tree_viewers': return kind({ node_id: isString });
    case 'members': return kind({ usernames: strings });
    case 'roles': return kind({ role_ids: strings });
    default: return false;
  }
}

function locationShape(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (v.kind === 'https') return fields(v, { kind: isString, url: isString });
  if (v.kind === 'github_pinned') return fields(v, { kind: isString, repo: isString, commit: isString, path: isString });
  return false;
}

const strings = (x: unknown): boolean => listOf(x, isString);
const capabilityShape = (v: unknown): boolean =>
  fields(v, { cap: oneOf(CAPABILITIES), why: isString, optional: isBool }, { hosts: strings, routes: strings, targets: strings, topics: strings });

/** Whether `v` has the manifest's shape. */
export function hasManifestShape(v: unknown): boolean {
  return fields(v, {
    format: isU32, id: isString, version: isString,
    sdk: (x: unknown) => fields(x, { abi: isString, min: isString, max: isString }),
    publisher: (x: unknown) => fields(x, { name: isString, mldsa65_public_key: isString, contact: isString }),
    name: isString, summary: isString, description: isString,
    icon: (x: unknown) => fields(x, { png_base64: isString, max_bytes: isU64 }),
    categories: (x: unknown) => listOf(x, oneOf(CATEGORIES)),
    audience: audienceShape,
    surfaces: (x: unknown) => listOf(x, oneOf(SURFACES)),
    scopes: (x: unknown) => listOf(x, oneOf(SCOPE_KINDS)),
    capabilities: (x: unknown) => listOf(x, capabilityShape),
    limits: (x: unknown) => fields(x, { memory_pages: isU32, max_call_rate_per_s: isU32, frame_budget_ms: isU32, storage_user_bytes: isU32, storage_scope_bytes: isU32, close_grace_ms: isU32 }, {
      storage_node_authored_bytes: isU32,
      p2p: (p: unknown) => fields(p, { max_fanout_concurrency: isU32, max_fanout_bytes: isU32, max_fanout_ms: isU32, max_response_bytes: isU32 }),
      topics: (t: unknown) => fields(t, { max_msg_bytes: isU32, max_msgs_per_s: isU32 }),
    }),
    artifact: (x: unknown) => fields(x, { sha256: isString, bytes: isU32, locations: (l: unknown) => listOf(l, locationShape) }),
  }, { previous_versions: strings });
}
