/**
 * A push must not reach someone the matching pull would refuse.
 *
 * `BroadcastAudience` exists because that kept happening. Its `Node` variant
 * carries the history in its own doc comment: node records went out as
 * `Everyone`, so every connected socket received the full `mdx_content` of any
 * document anyone saved — including a member who had just been removed, whose
 * socket stays open, and, where one server holds several workspaces, sessions
 * belonging to a different one.
 *
 * That reasoning applied word for word to the workspace-shaped broadcast and was
 * not carried to it. `UpdateWorkspace` and `UpdateWorkspaceTheme` both sent the
 * whole `Workspace` record — name, description, `owner_id` and the FULL MEMBER
 * LIST — through plain `broadcast()`, which is `Everyone`. Renaming a workspace
 * pushed its record to every session on the box, including users whose
 * `GetWorkspace` for it is refused and whose `ListWorkspaces` omits it, and
 * including a member set to `Banned`, because nothing closes their socket.
 *
 * THE RULE: a response variant that carries per-entity data must be broadcast
 * through the helper that scopes it. `Everyone` is for genuinely workspace-wide
 * status, and naming a scoped variant there is a disclosure, not a style choice.
 *
 * WHAT THIS CANNOT SEE: whether the scoping PREDICATE is right — only that a
 * scoped variant is not sent unscoped. The predicate is pinned by the kernel's
 * own tests.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = join(ROOT, 'citadel-workspace-server-kernel', 'src');

if (!existsSync(KERNEL)) {
  console.error('FAIL: the server kernel source is not present — this gate examined nothing.');
  process.exit(1);
}

/**
 * Response variants that carry data scoped to one entity, with the helper each
 * must go through.
 */
const SCOPED = new Map([
  ['Workspace', 'broadcast_to_workspace'],
  ['Node', 'broadcast_to_node'],
  ['NodeContent', 'broadcast_to_node'],
]);

/** The unscoped helper. */
const PLAIN_BROADCAST = /\bbroadcast\s*\(/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { yield* walk(full); continue; }
    if (entry.endsWith('.rs')) yield full;
  }
}

const problems = [];
let filesRead = 0;
let broadcastsSeen = 0;

for (const file of walk(KERNEL)) {
  filesRead += 1;
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // a comment broadcasts nothing
    if (!PLAIN_BROADCAST.test(line)) continue;
    // `broadcast_to_node(` etc. also contain `broadcast(`? No — but be explicit.
    if (/broadcast_to_\w+\s*\(/.test(line)) continue;
    if (/fn\s+broadcast/.test(line)) continue;
    broadcastsSeen += 1;

    // The variant is on this line or the next few (rustfmt wraps the argument).
    const window = lines.slice(i, Math.min(i + 4, lines.length)).join('\n');
    for (const [variant, helper] of SCOPED) {
      const named = new RegExp(`WorkspaceProtocolResponse::${variant}\\s*[({]`);
      if (named.test(window)) {
        problems.push(
          `${rel}:${i + 1}: broadcasts \`${variant}\` through the unscoped \`broadcast()\` — ` +
            `use \`${helper}\``,
        );
      }
    }
  }
}

// Vacuity floor: this kernel broadcasts. Reading none means the helper was
// renamed and this gate reports safety over nothing.
if (filesRead < 20 || broadcastsSeen === 0) {
  console.error(
    `FAIL: read ${filesRead} file(s) and ${broadcastsSeen} unscoped broadcast(s).\n` +
      'A zero means `broadcast(` is spelled differently now, not that nothing broadcasts.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAIL: ${problems.length} broadcast(s) that reach more sessions than the pull would.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nA push must not reach someone the matching pull would refuse. The last one sent a\n' +
      "workspace's name, owner and FULL MEMBER LIST to every session on the server, including\n" +
      'users whose GetWorkspace for it is refused.',
  );
  process.exit(1);
}

console.log(
  `check-broadcasts-name-their-audience: ${broadcastsSeen} unscoped broadcast(s) across ` +
    `${filesRead} kernel file(s); none carries a variant that must be scoped.`,
);
