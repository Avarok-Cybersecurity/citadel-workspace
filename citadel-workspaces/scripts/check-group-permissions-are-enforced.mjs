#!/usr/bin/env node
/**
 * Every permission the group role editor offers must be read somewhere.
 *
 * `GroupPermissions` has eight keys. The role editor renders a labelled switch
 * for every one of them ("Send Messages -- Can send messages in the group
 * chat", "View Member List -- Can see all members of the group"), the role
 * summary lists them, and `useGroupPermissions` computes them carefully,
 * including a deliberate "No role = no permissions" branch.
 *
 * Two of the eight were then read by nothing. `sendMessages` lost because the
 * one composer hardcoded `canSendMessages={true}`; `viewMemberList` lost
 * because every roster rendered unconditionally. An admin could build a muted
 * role, assign it, and the member would send messages anyway and see the whole
 * membership -- with the UI stating otherwise on the role's own settings page.
 *
 * Group roles are entirely client-side state, so there is no server behind
 * them to enforce what the client does not. A switch that governs nothing is
 * worse than an absent one: it is a stated restriction that is not true.
 *
 * Node 18-compatible on purpose: the lint jobs run the oldest supported Node.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TYPES = 'src/types/group-permissions.ts';
const ROOT = 'src';

/** Files that define or describe the permissions rather than acting on them. */
const NOT_A_CONSUMER = [
  'src/types/group-permissions.ts',
  'src/components/chat/GroupRoleEditorConstants.ts',
  'src/components/chat/GroupRoleHelpers.tsx',
  'src/hooks/use-group-permissions.ts',
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      out.push(...walk(p));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

const types = readFileSync(TYPES, 'utf8');
const block = types.match(/export interface GroupPermissions \{([^}]*)\}/);
if (!block) {
  console.error(`::error file=citadel-workspaces/${TYPES}::could not find the GroupPermissions interface -- this gate is reading the wrong file`);
  process.exit(1);
}
const keys = [...block[1].matchAll(/^\s*([a-zA-Z]+)\s*:/gm)].map((m) => m[1]);
if (keys.length === 0) {
  console.error(`::error file=citadel-workspaces/${TYPES}::GroupPermissions parsed to zero keys -- this gate cannot fail as written`);
  process.exit(1);
}

const files = walk(ROOT).filter((f) => !NOT_A_CONSUMER.includes(f.split('\\').join('/')));
const corpus = files.map((f) => readFileSync(f, 'utf8')).join('\n');

const inert = keys.filter(
  (key) => !corpus.includes(`can('${key}')`) && !corpus.includes(`permissions.${key}`),
);

if (inert.length > 0) {
  for (const key of inert) {
    console.error(
      `::error file=citadel-workspaces/${TYPES}::the group role editor offers "${key}" as a switch and nothing reads it. ` +
        `Gate the thing it governs on can('${key}'), or remove it from GroupPermissions -- a restriction the UI states and does not apply is worse than no switch.`,
    );
  }
  process.exit(1);
}

console.log(`  Group permissions: all ${keys.length} switch(es) are read somewhere  ok`);
