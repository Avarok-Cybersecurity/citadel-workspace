#!/usr/bin/env node
/**
 * The Permission enum exists twice: authoritatively in Rust
 * (citadel-workspace-types) and mirrored in TypeScript for the admin UI. They
 * drifted — EditTreeStructure and ManageNodeTypes were held by the Owner role
 * on the server but absent from the TS enum entirely, so the permission editor
 * could neither show nor grant them, and a server response carrying one had no
 * TypeScript value to land on.
 *
 * This checks three things:
 *   1. every Rust variant has a TS enum member with the same string value;
 *   2. every TS member has a human label;
 *   3. every permission appears in exactly one PERMISSION_CATEGORIES group, so
 *      the editor renders all of them.
 *   4. every permission the editor renders is ACTUALLY ENFORCED somewhere in the
 *      server, or is explicitly declared as gated by something else.
 *
 * Check 4 exists because matching names are not the same as a working control.
 * `UploadFiles` and `DownloadFiles` passed checks 1-3 for their whole life --
 * both enums, both labelled, both in the "Files" category with allowed/total
 * badges -- while the server consulted neither: every file transfer was
 * auto-accepted behind one global boolean. A read-only Guest could push files
 * into server storage and pull them back out, and the matrix showed an operator
 * a control that did nothing.
 *
 * A permission with no server reference is not automatically a bug: several are
 * genuinely enforced under a different variant's name. But that has to be
 * DECLARED, in GATED_BY below, with what actually gates it -- so the next
 * unenforced permission has to be justified rather than merely named.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const rust = readFileSync('citadel-workspace-types/src/structs.rs', 'utf8');
const ts = readFileSync(
  'citadel-workspaces/src/lib/permissions-service/types.ts',
  'utf8',
);

const enumBody = /pub enum Permission \{([\s\S]*?)\n\}/.exec(rust);
if (!enumBody) throw new Error('could not locate `pub enum Permission` in structs.rs');
const rustVariants = [...enumBody[1].matchAll(/^\s*(\w+),/gm)].map((m) => m[1]);

const tsBody = /export enum Permission \{([\s\S]*?)\n\}/.exec(ts);
if (!tsBody) throw new Error('could not locate `export enum Permission` in types.ts');
const tsMembers = new Map(
  [...tsBody[1].matchAll(/^\s*(\w+)\s*=\s*'([^']+)',/gm)].map((m) => [m[1], m[2]]),
);

const labelBlock = /PERMISSION_LABELS[\s\S]*?\n\};/.exec(ts)?.[0] ?? '';
const labelled = new Set([...labelBlock.matchAll(/\[Permission\.(\w+)\]/g)].map((m) => m[1]));

const categoryBlock = /PERMISSION_CATEGORIES[\s\S]*?\n\} as const;/.exec(ts)?.[0] ?? '';
const categorised = [...categoryBlock.matchAll(/Permission\.(\w+)/g)].map((m) => m[1]);

const problems = [];

for (const variant of rustVariants) {
  if (!tsMembers.has(variant)) {
    problems.push(`${variant}: in the Rust enum, missing from the TypeScript enum`);
    continue;
  }
  if (tsMembers.get(variant) !== variant) {
    problems.push(
      `${variant}: TypeScript value is '${tsMembers.get(variant)}', which will not match the wire format`,
    );
  }
  if (!labelled.has(variant)) {
    problems.push(`${variant}: no entry in PERMISSION_LABELS`);
  }
  const seen = categorised.filter((p) => p === variant).length;
  if (seen === 0) {
    problems.push(
      `${variant}: not in any PERMISSION_CATEGORIES group, so the permission editor cannot grant it`,
    );
  } else if (seen > 1) {
    problems.push(`${variant}: appears in ${seen} PERMISSION_CATEGORIES groups`);
  }
}

for (const member of tsMembers.keys()) {
  if (!rustVariants.includes(member)) {
    problems.push(`${member}: in the TypeScript enum but not in the Rust enum`);
  }
}

// ---------------------------------------------------------------------------
// Role definitions. The server decides access; the admin UI only previews it.
// Three copies of the role model existed and all three disagreed — the UI
// offered Member "EditContent", which the server refuses, and offered Owner a
// set that omitted permissions the server grants it.
// ---------------------------------------------------------------------------

/** A role holding the `All` wildcard effectively holds every permission. */
const effective = (perms) =>
  new Set(perms.includes('All') ? rustVariants : perms);

const forRole = /pub fn for_role[\s\S]*?\n    \}/.exec(rust);
if (!forRole) throw new Error('could not locate `Permission::for_role` in structs.rs');

/** Variants excluded by a `!matches!(p, Self::A | Self::B)` filter. */
const excludedBy = (text) => {
  const m = /matches!\(\s*p\s*,([^)]*)\)/.exec(text);
  return m ? [...m[1].matchAll(/Self::(\w+)/g)].map((x) => x[1]) : [];
};

const rustRoles = {};
const armRe = /UserRole::(\w+) => \{([\s\S]*?)\n            \}/g;
for (const [, role, body] of forRole[0].matchAll(armRe)) {
  if (role === 'Custom') continue; // rank-derived, not a fixed role
  if (body.includes('ALL_VARIANTS')) {
    const excluded = excludedBy(body);
    if (excluded.length === 0) {
      throw new Error(`the ${role} arm derives from ALL_VARIANTS but no exclusion was parsed`);
    }
    rustRoles[role] = rustVariants.filter((v) => !excluded.includes(v));
  } else {
    rustRoles[role] = [...body.matchAll(/permissions\.insert\(Self::(\w+)\)/g)].map((m) => m[1]);
  }
}

const tsRoleBlock = /ROLE_DEFAULT_PERMISSIONS[\s\S]*?\n\};/.exec(ts);
if (!tsRoleBlock) throw new Error('could not locate ROLE_DEFAULT_PERMISSIONS in types.ts');

const tsRoles = {};
for (const [, role, body] of tsRoleBlock[0].matchAll(/^  (\w+): ([\s\S]*?),\n(?=  \w+:|\};)/gm)) {
  if (body.includes('ALL_PERMISSIONS.filter')) {
    const excluded = [...body.matchAll(/!==\s*Permission\.(\w+)/g)].map((m) => m[1]);
    if (excluded.length === 0) {
      throw new Error(`the ${role} entry filters ALL_PERMISSIONS but no exclusion was parsed`);
    }
    tsRoles[role] = rustVariants.filter((v) => !excluded.includes(v));
  } else if (body.trim() === 'ALL_PERMISSIONS') {
    tsRoles[role] = [...rustVariants];
  } else {
    tsRoles[role] = [...body.matchAll(/Permission\.(\w+)/g)].map((m) => m[1]);
  }
}

for (const [role, rustPerms] of Object.entries(rustRoles)) {
  const tsPerms = tsRoles[role];
  if (!tsPerms) {
    problems.push(`role ${role}: defined in Rust, missing from ROLE_DEFAULT_PERMISSIONS`);
    continue;
  }
  const a = effective(rustPerms);
  const b = effective(tsPerms);
  for (const perm of a) {
    if (!b.has(perm)) problems.push(`role ${role}: server grants ${perm}, the UI does not`);
  }
  for (const perm of b) {
    if (!a.has(perm)) problems.push(`role ${role}: the UI offers ${perm}, the server does not grant it`);
  }
}

for (const role of Object.keys(tsRoles)) {
  if (!rustRoles[role]) problems.push(`role ${role}: in ROLE_DEFAULT_PERMISSIONS but not a Rust UserRole arm`);
}

// --- 4. enforcement ---------------------------------------------------------
//
// Each entry says what actually gates the operation this permission names. An
// entry is required for every rendered permission the server never mentions.
const GATED_BY = {
  // Enforced under a broader variant chosen by what the update changes.
  UpdateNode: 'EditTreeStructure / EditMdx in async_node_ops::update_node',
  EditNodeConfig: 'EditTreeStructure / EditMdx in async_node_ops::update_node',
  UpdateNodeSettings: 'EditTreeStructure / EditMdx in async_node_ops::update_node',
  AddNode: 'CreateNode in async_domain_server_ops',
  EditContent: 'EditMdx / EditTreeStructure on the node being edited',
  // Reads are gated on ViewContent; group_access::authorize_group_read.
  ReadMessages: 'ViewContent in kernel::group_access',
  // Workspace-level operations take admin-or-owner plus the master password.
  UpdateWorkspace: 'is_admin or workspace owner, plus the master password',
  DeleteWorkspace: 'is_admin or workspace owner, plus the master password',
  ManageNodeMembers: 'AddUsers / RemoveUsers in async_domain_server_ops',
  ManageNodeTypes: 'is_admin on CreateNodeType and UpdateTreeSchema',
  // No such operation exists in the server yet. Listed so the matrix showing a
  // toggle for it is a known, deliberate gap rather than an unnoticed one.
  BanUser: 'NOT IMPLEMENTED - no ban operation exists',
  ManageDomains: 'NOT IMPLEMENTED - no domain-management operation exists',
  ConfigureSystem: 'NOT IMPLEMENTED - no system-configuration operation exists',
  EditWorkspaceConfig: 'NOT IMPLEMENTED - no workspace-config operation exists',
};

// Comments are stripped first, and that is not a detail. This check's own
// negative control caught it: reverting the file-transfer enforcement still
// left `Permission::UploadFiles` matching, because `may_transfer`'s doc comment
// names it. A permission "enforced" by prose is exactly the failure this gate
// exists to catch, so prose must not count.
const rustFiles = execFileSync(
  'find',
  ['citadel-workspace-server-kernel/src', '-name', '*.rs', '-not', '-path', '*/target/*'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

const enforced = new Set();
for (const file of rustFiles) {
  const code = stripComments(readFileSync(file, 'utf8'));
  for (const m of code.matchAll(/Permission::([A-Za-z0-9]+)/g)) enforced.add(m[1]);
}

for (const perm of new Set(categorised)) {
  if (enforced.has(perm)) {
    if (GATED_BY[perm]) {
      problems.push(
        `${perm}: the server enforces it directly, so its GATED_BY entry is stale — remove it`,
      );
    }
    continue;
  }
  if (!GATED_BY[perm]) {
    problems.push(
      `${perm}: rendered as a grantable toggle but never referenced in the server. ` +
        `Either enforce it, or add a GATED_BY entry naming what does.`,
    );
  }
}

if (problems.length > 0) {
  console.error('Permission enum parity (Rust <-> TypeScript):\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    `\n${problems.length} problem(s). The Rust enum in citadel-workspace-types is authoritative.`,
  );
  process.exit(1);
}

console.log(
  `Permission parity OK: ${rustVariants.length} variants and ${Object.keys(rustRoles).length} roles agree across Rust and TypeScript.`,
);
