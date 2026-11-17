/**
 * A group CONTROL message: the group's name, roles and role assignments, sent
 * over the same `GroupMessage` transport as chat.
 *
 * `GroupCreate` and `GroupInvite` carry no name and there is no wire field for
 * roles at all, so a rename or a role change stayed on the device that made it.
 * The group-message body is the one payload the members define themselves.
 *
 * WHY THERE IS NO `content` FIELD. Every build's `decodeGroupMessage` requires
 * `content` to be a string and returns null otherwise; the inbound path logs
 * "did not decode" and drops the body. So a client that predates this envelope
 * IGNORES it -- it never becomes a chat bubble, garbled or otherwise. A
 * `content` string here would make older builds render it as text.
 */
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import type { GroupSettings } from '@/types/group';
import type { GroupRole, GroupPermissions } from '@/types/group-permissions';

export interface GroupRoleAssignment {
  cid: bigint;
  role_id: string;
}

export interface GroupControlBody {
  name?: string;
  settings?: GroupSettings;
  assignments?: GroupRoleAssignment[];
  /** Asks the group's members for their current snapshot; see learn-joined-groups.ts. */
  request_state?: true;
}

export interface PeerGroupControl {
  group_id: string;
  message_id: string;
  sender_cid: bigint;
  timestamp: number;
  control: GroupControlBody;
}

const PERMISSION_KEYS: ReadonlyArray<keyof GroupPermissions> = [
  'sendMessages', 'viewMemberList', 'inviteMembers', 'kickMembers',
  'manageRoles', 'assignRoles', 'editGroupSettings', 'deleteGroup',
];

export function encodeGroupControl(message: PeerGroupControl): Uint8Array {
  return cborEncode(message);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toPermissions(raw: unknown): GroupPermissions | null {
  const record: Record<string, unknown> | null = asRecord(raw);
  if (!record) return null;
  const permissions: Partial<GroupPermissions> = {};
  for (const key of PERMISSION_KEYS) {
    const value: unknown = record[key];
    if (typeof value !== 'boolean') return null;
    permissions[key] = value;
  }
  return permissions as GroupPermissions;
}

function toRole(raw: unknown): GroupRole | null {
  const r: Record<string, unknown> | null = asRecord(raw);
  if (!r) return null;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.position !== 'number') return null;
  if (typeof r.isDefault !== 'boolean' || typeof r.isBuiltIn !== 'boolean') return null;
  if (r.color !== undefined && typeof r.color !== 'string') return null;
  const permissions: GroupPermissions | null = toPermissions(r.permissions);
  if (!permissions) return null;
  const role: GroupRole = { id: r.id, name: r.name, position: r.position, permissions, isDefault: r.isDefault, isBuiltIn: r.isBuiltIn };
  if (typeof r.color === 'string') role.color = r.color;
  return role;
}

/** All or nothing: a role list with one unreadable role is not a role list. */
function toSettings(raw: unknown): GroupSettings | null {
  const s: Record<string, unknown> | null = asRecord(raw);
  if (!s || !Array.isArray(s.roles) || typeof s.defaultRoleId !== 'string') return null;
  const roles: GroupRole[] = [];
  for (const entry of s.roles) {
    const role: GroupRole | null = toRole(entry);
    if (!role) return null;
    roles.push(role);
  }
  if (!roles.some((role) => role.id === s.defaultRoleId)) return null;
  return { roles, defaultRoleId: s.defaultRoleId };
}

function toAssignments(raw: unknown): GroupRoleAssignment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: GroupRoleAssignment[] = [];
  for (const entry of raw) {
    const a: Record<string, unknown> | null = asRecord(entry);
    if (!a || typeof a.cid !== 'bigint' || typeof a.role_id !== 'string') return null;
    out.push({ cid: a.cid, role_id: a.role_id });
  }
  return out;
}

function toBody(raw: unknown): GroupControlBody | null {
  const c: Record<string, unknown> | null = asRecord(raw);
  if (!c) return null;
  const body: GroupControlBody = {};
  if (typeof c.name === 'string') body.name = c.name;
  if (c.request_state === true) body.request_state = true;
  if (c.settings !== undefined) {
    const settings: GroupSettings | null = toSettings(c.settings);
    if (!settings) return null;
    body.settings = settings;
  }
  if (c.assignments !== undefined) {
    const assignments: GroupRoleAssignment[] | null = toAssignments(c.assignments);
    if (!assignments) return null;
    body.assignments = assignments;
  }
  return body;
}

/** Null for anything that is not a well-formed control envelope, including every chat message. */
export function decodeGroupControl(bytes: Uint8Array): PeerGroupControl | null {
  try {
    const decoded: Record<string, unknown> | null = asRecord(cborDecode(bytes));
    if (!decoded || decoded.control === undefined) return null;
    if (typeof decoded.group_id !== 'string' || typeof decoded.message_id !== 'string') return null;
    if (typeof decoded.sender_cid !== 'bigint') return null;
    const control: GroupControlBody | null = toBody(decoded.control);
    if (!control) return null;
    return {
      group_id: decoded.group_id,
      message_id: decoded.message_id,
      sender_cid: decoded.sender_cid,
      timestamp: typeof decoded.timestamp === 'number' ? decoded.timestamp : Date.now(),
      control,
    };
  } catch {
    return null;
  }
}
