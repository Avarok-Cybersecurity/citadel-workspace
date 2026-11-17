/**
 * The gates preflight derives from CI: validate.yml, each step in the directory CI gives it.
 *
 * The UI repo's workflow was read here too while the UI was a submodule with CI of its own; its
 * gates moved into validate.yml when the UI was folded into citadel-workspaces/.
 *
 * NEEDS_MORE_THAN_A_CHECKOUT below is the ONE place that says which CI gates preflight does not
 * run, and why (with MERGE_PREVIEW_CANNOT_JUDGE beside it for the merge preview). Everything else
 * is run -- a new CI gate is included by default.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deriveGates, nodeRequirement } from './ci-gates.mjs';

/**
 * Gates that genuinely cannot run on a checkout, keyed by command, with what they need.
 * The key is the script path (`scripts/x.mjs`) or the whole npm command.
 */
export const NEEDS_MORE_THAN_A_CHECKOUT = new Map([
  ['scripts/check-production-image.mjs', 'drives a real browser against a built production Docker image'],
  ['scripts/lib/assert-pe-subsystem.mjs', 'inspects the Windows release binary, which only the cross-compile job produces'],
]);

/**
 * Gates merge-preview's fast tier leaves out of a merged overlay, with why. (Same file as the list
 * above on purpose: one place says what is skipped where.)
 */
export const MERGE_PREVIEW_CANNOT_JUDGE = new Map([
  ['npm test', 'runs npm, and npm must never run in the overlay: its node_modules are links into this clone'],
  ['scripts/check-committed-bindings-match-the-rust.mjs', 'runs `cargo test -p citadel-workspace-types`, and a Rust target directory per preview is what the preview avoids'],
  ['scripts/agent-release-state.mjs', 'judges a PR against the agent-v* tags and its own base; a synthetic merge of many PRs is neither'],
]);

/**
 * Static gates the pre-commit hook leaves to pre-push and the full run, with why: too slow for its
 * ~10 s budget, or unable to pass mid-commit.
 */
export const NOT_ON_PRE_COMMIT = new Map([
  ['scripts/check-explicit-types.mjs', 'type-aware lint of all of src/: 18 s measured, alone over the budget'],
  ['scripts/check-submodule-work-is-committed.mjs', 'asks whether submodule edits are committed, which a commit in the submodule is in the middle of doing'],
]);

export const PARENT_WORKFLOW = '.github/workflows/validate.yml';

/** A gate's skip key: its script, or the whole command for npm and `node --test`. */
export function gateKey(argv) {
  return argv[0] === 'node' && argv[1]?.startsWith('scripts/') ? argv[1] : argv.join(' ');
}

function read(root, path) {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch {
    // An unreadable workflow means an empty gate list, and an empty list is a clean run over nothing.
    throw new Error(`cannot read ${path}; the gate list would be empty.`);
  }
}

/** The script a check executes, for reading its source: `node x.mjs`, or the npm script's target. */
function scriptOf(root, gate) {
  const [cmd, first, second] = gate.argv;
  if (cmd === 'node') return join(gate.cwd, first === '--test' ? second : first);
  if (cmd !== 'npm') return null;
  const pkg = JSON.parse(readFileSync(join(gate.cwd, 'package.json'), 'utf8'));
  const body = pkg.scripts?.[first === 'test' ? 'test' : second] ?? '';
  const target = /node\s+(\S+\.m?js)/.exec(body)?.[1];
  return target ? join(gate.cwd, target) : null;
}

/** Every derived gate as a preflight check, the skipped ones, and the Node requirement. */
export function derivedChecks(root) {
  const parentText = read(root, PARENT_WORKFLOW);
  const all = deriveGates({ text: parentText, source: 'parent', resolveDir: (wd) => join(root, wd), seen: new Map() });
  if (all.length < 10) {
    throw new Error(`only ${all.length} gates found in ${PARENT_WORKFLOW}; it moved or changed shape, so the list cannot be trusted`);
  }
  const skipped = [];
  const checks = [];
  const run = [];
  for (const gate of all) {
    const reason = NEEDS_MORE_THAN_A_CHECKOUT.get(gateKey(gate.argv));
    if (reason) {
      skipped.push([gate.label, reason]);
      continue;
    }
    run.push(gate);
    const script = scriptOf(root, gate);
    const area = relative(root, gate.cwd).split('/')[0] || null;
    checks.push({
      name: gate.label,
      cmd: gate.argv[0],
      args: gate.argv.slice(1),
      cwd: gate.cwd,
      env: gate.env,
      kind: gate.heavy ? 'heavy' : 'static',
      area,
      script: script ? relative(root, script) : null,
      sources: gate.sources,
    });
  }
  return { checks, skipped, node: nodeRequirement(run) };
}
