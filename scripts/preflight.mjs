#!/usr/bin/env node
/**
 * Every CI gate that can run without Docker, in one command.
 *
 * The local loop was tsc + eslint + vitest + the submodule-pointer guard, while
 * CI runs eleven things. Three gates were found red by finally running them by
 * hand — the 250-line cap (twice), the stack-reachability guard, and
 * workspace-wide clippy — and the line cap was then broken twice MORE after
 * that failure had been written down. Recording a gap did not close it; a
 * runnable command might.
 *
 * Deliberately does NOT run: anything needing Docker or a live stack, or the
 * integration suites (they share one backend).
 *
 * It used to exclude the submodule-pointer check too, on the grounds that it
 * "is about pushing, not about the code being correct". That reasoning was
 * wrong and cost a whole CI run: an unpushed submodule commit makes
 * `actions/checkout` fail, so all 73 jobs died before compiling a line and the
 * run reported nothing at all about the code. Whether a push will produce a
 * meaningful run is exactly what a pre-push gate is for. The guard existed and
 * was correct; nothing invoked it.
 *
 * The script list is DERIVED from validate.yml, not written out here.
 *
 * It used to be a hand-maintained array, and it drifted: CI grew to twenty-one
 * `node scripts/*.mjs` gates while this file still listed ten, so eleven checks
 * a developer could have run in one second locally were only ever discovered by
 * pushing. That is the same failure this file was written to end, re-appearing
 * one gate at a time — which is what a hand-copied list does. Reading the
 * workflow means adding a gate to CI adds it here, with no second edit.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(ROOT, 'citadel-workspaces');
const IS = join(ROOT, 'citadel-internal-service');

/**
 * Gates that genuinely cannot run here, with the reason. Anything NOT listed is
 * run — so a new CI gate is included by default and this file has to be edited
 * to exclude it, rather than edited to include it.
 */
const NEEDS_MORE_THAN_A_CHECKOUT = new Map([
  ['check-production-image.mjs', 'drives a real browser against a built production image'],
]);

/** Every `node scripts/<name>.mjs` step in the workflow, in file order. */
function ciScriptGates() {
  const path = join(ROOT, '.github/workflows/validate.yml');
  let workflow;
  try {
    workflow = readFileSync(path, 'utf8');
  } catch {
    // An unreadable workflow means an empty gate list, and an empty gate list
    // is a clean run over nothing. Say which file, rather than a stack trace.
    console.error(`preflight: cannot read ${path}; the gate list would be empty.`);
    process.exit(1);
  }
  // Each gate carries the DIRECTORY its step runs in.
  //
  // The regex version took the script path and ran everything from the repo
  // root, which is right for most steps and wrong for any step with a
  // `working-directory:`. The first such gate reported a module-not-found from
  // preflight while passing in CI, which is the failure mode preflight exists to
  // prevent, pointed the other way.
  //
  // Read line by line rather than with a YAML parser: preflight runs on a bare
  // checkout too, and a gate that needs an install is a gate that does not run
  // (see check-service-logs-are-captured, which took a whole CI job down for
  // exactly that). A `working-directory:` belongs to the step above it, so the
  // last one seen before a `node scripts/...` line is that step's.
  // A step's `working-directory:` can sit either side of its `run:`, so each
  // step is buffered and read whole. The first line-by-line version tracked the
  // last directory seen and missed the one gate that declares it AFTERWARDS --
  // which is the gate that motivated all of this.
  const found = [];
  const steps = [];
  let buffer = [];
  for (const line of workflow.split('\n')) {
    if (/^\s{6}-\s/.test(line)) {
      if (buffer.length > 0) steps.push(buffer);
      buffer = [line];
      continue;
    }
    buffer.push(line);
  }
  if (buffer.length > 0) steps.push(buffer);

  for (const step of steps) {
    const text = step.join('\n');
    const directory = /^\s*working-directory:\s*(\S+)/m.exec(text)?.[1] ?? '.';
    // The rest of the line, not just the script path.
    //
    // This captured the path alone and ran every gate with no arguments, which
    // is right for all but two of them and silently wrong for the one that
    // matters: CI runs `node scripts/build-gates-index.mjs --check`, and
    // WITHOUT `--check` that script takes its else branch and WRITES
    // docs/GATES.md. So preflight rewrote a tracked file in the developer's
    // working tree and printed `build gates index … ok` -- a check-only
    // command turned into a mutation, and a gate that could not fail. The CI
    // job it stands in for then went red on a file preflight claimed to have
    // checked.
    for (const match of text.matchAll(/node\s+(scripts\/[a-z0-9-]+\.mjs)([^\n]*)/g)) {
      const args = match[2]
        .split('#')[0] // a trailing YAML comment is not an argument
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      found.push([match[1], directory, args]);
    }
  }
  const unique = [
    ...new Map(
      found.map(([script, dir, args]) => [`${dir}:${script}:${args.join(' ')}`, [script, dir, args]]),
    ).values(),
  ];
  // A guard that silently checks nothing is the thing this repo keeps finding.
  // If the workflow is renamed or its shape changes, say so rather than
  // reporting a clean run over an empty list.
  if (unique.length < 10) {
    console.error(
      `preflight: only ${unique.length} script gates found in validate.yml — ` +
        'the workflow moved or changed shape, so this list cannot be trusted.',
    );
    process.exit(1);
  }
  return unique;
}

const skipped = [];
const derived = ciScriptGates().flatMap(([script, dir, args]) => {
  const name = script.replace(/^scripts\//, '').replace(/\.mjs$/, '');
  const reason = NEEDS_MORE_THAN_A_CHECKOUT.get(script.replace(/^scripts\//, ''));
  if (reason) {
    skipped.push([name, reason]);
    return [];
  }
  const label = [name.replace(/^check-/, '').replace(/-/g, ' '), ...args].join(' ');
  return [[label, 'node', [script, ...args], join(ROOT, dir)]];
});

/**
 * The cargo gates, which preflight ran none of.
 *
 * The header above named workspace-wide clippy as one of three gates found red
 * only by hand — and then omitted it, invisibly: the derived list matches
 * `node scripts/*.mjs` only, so the cargo steps never entered the list and so
 * never reached the skip report either. A Rust-only edit passed preflight
 * untouched and failed CI half an hour later. Both were red when this was
 * written: an unformatted file in intersession-layer-messaging, an orphaned doc
 * comment and four redundant field patterns in the server kernel.
 *
 * SKIP_WASM_BUILD is not a convenience. citadel-workspace-internal-service has
 * a build script that runs wasm-pack and copies the result over the tracked
 * artifacts in citadel-workspace-client-ts/pkg/ and citadel-workspaces/public/
 * wasm — so a plain `cargo clippy` silently replaces the committed WASM the UI
 * imports. A gate that mutates the tree it is checking is not one you can run
 * before every commit.
 *
 * Skipped rather than failed when cargo is absent: a frontend-only checkout is
 * a legitimate way to work here, and a missing toolchain is not a red gate.
 */
const CARGO_WORKSPACES = [
  ['rust workspace', ROOT],
  ['rust internal-service workspace', join(ROOT, 'citadel-internal-service')],
];

const haveCargo = spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status === 0;

const cargoChecks = CARGO_WORKSPACES.flatMap(([label, cwd]) => {
  if (!haveCargo) {
    skipped.push([`${label} fmt + clippy`, 'cargo is not on PATH']);
    return [];
  }
  return [
    [`${label} fmt`, 'cargo', ['fmt', '--all', '--check'], cwd],
    [
      `${label} clippy`,
      'cargo',
      ['clippy', '--workspace', '--all-targets', '--', '-D', 'warnings'],
      cwd,
    ],
  ];
});

const CHECKS = [
  ...derived,
  // Not in validate.yml, because by the time CI runs it is already too late:
  // checkout is what fails.
  // Ordered first among the local-only checks: an uninitialised clone makes
  // every check after it meaningless, and npm's own error names a workspace
  // rather than the missing checkout.
  ['submodules are populated', 'node', ['scripts/check-submodules-are-populated.mjs'], ROOT],
  ['submodule pointers pushed', 'node', ['scripts/check-submodule-pointers-pushed.mjs'], ROOT],
  ['event listeners have emitters', 'node', ['scripts/check-event-listeners-have-emitters.mjs'], UI],
  ['generated artefacts present', 'node', ['scripts/check-generated-artefacts-present.mjs'], ROOT],
  // Ordered before typecheck deliberately: the three checks below all consume
  // generated artefacts, and without them they fail in a way that reads as a
  // defect in the source rather than a missing build step.
  //
  // A fresh clone running `npm run preflight` used to get eight errors of the
  // form "Property 'id' does not exist on type 'GroupMessage'" plus "Cannot
  // find module 'citadel-workspace-client-ts'". Both are true statements about
  // an unbuilt tree and neither says so. CLAUDE.md documents the order --
  // typescript-client (WASM types), then citadel-workspace-client-ts, then
  // typecheck -- and this makes skipping it say its own name.
  // The generated bindings type-check on their own, which CI does and this did
  // not. ts-rs cannot see the types named inside a `#[ts(type = "...")]`
  // override, so regenerating the bindings — the documented way to add a field —
  // DROPS those imports while the files keep referencing the types. 36 files at
  // once, and the only thing that said so was `tsc` in CI, a full cycle later.
  ['generated bindings typecheck', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'],
    'citadel-internal-service/typescript-client'],
  ['typecheck', 'npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit'], UI],
  ['eslint', 'npx', ['eslint', '.', '--max-warnings', '0'], UI],
  ['unit tests', 'npx', ['vitest', 'run'], UI],
  // The wasm target, because nothing else local compiles it.
  //
  // `store_value_inner` in ILM's testing.rs lost its
  // `#[cfg(not(target_arch = "wasm32"))]` when its body was moved out of a
  // trait impl. On NATIVE that is invisible: the wasm-only block is excluded,
  // so the unguarded one still lands last and everything type-checks. The
  // crate built, 71 tests passed, clippy was clean and this very script
  // reported 75/75 -- while `wasm32-unknown-unknown` could not build at all.
  // CI found it in the Production Docker Build, which is also what produces
  // the browser's WASM, so the same slip took the Playwright shard down with
  // it.
  //
  // `cargo check` on the wasm CLIENT crate, not on ILM directly: a bare check
  // of ILM fails on uuid's randomness feature, which the client crate supplies.
  // This is a check, not a build -- it emits no pkg/ artifacts, so it cannot
  // overwrite the committed WASM the way a wasm-pack run would.
  ['rust wasm target compiles', 'cargo', ['check', '-p', 'citadel-internal-service-wasm-client', '--target', 'wasm32-unknown-unknown'], IS],
  ...cargoChecks,
];

// `--print-plan` prints what preflight WOULD run, as JSON, and exits.
//
// It exists so check-preflight-runs-what-ci-runs.mjs can compare this plan
// against validate.yml without re-implementing the workflow parse. A second
// copy of that parse is a second thing to drift, which is the failure this
// file's header already describes once.
if (process.argv.includes('--print-plan')) {
  // writeFileSync to fd 1, not console.log: `process.exit` immediately after a
  // console.log truncates a PIPED write at the 8 KB pipe buffer, and this plan
  // is ~40 KB. The reader got valid JSON that simply stopped mid-token. A
  // synchronous write finishes before the exit.
  writeFileSync(1, `${JSON.stringify(CHECKS.map(([name, cmd, args, cwd]) => ({ name, cmd, args, cwd })))}\n`);
  process.exit(0);
}

const failed = [];
for (const [name, cmd, args, cwd] of CHECKS) {
  process.stdout.write(`  ${name} … `);
  // SKIP_WASM_BUILD keeps the cargo gates from rebuilding the WASM client and
  // overwriting the tracked artifacts under it. Harmless for everything else.
  const run = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SKIP_WASM_BUILD: '1' },
  });
  if (run.status === 0) {
    console.log('ok');
  } else {
    console.log('FAILED');
    failed.push({ name, output: `${run.stdout ?? ''}${run.stderr ?? ''}`.trim() });
  }
}

if (failed.length > 0) {
  for (const { name, output } of failed) {
    console.error(`\n─── ${name} ───\n${output.split('\n').slice(-40).join('\n')}`);
  }
  console.error(`\n${failed.length} of ${CHECKS.length} checks failed.`);
  process.exit(1);
}

if (skipped.length > 0) {
  // Named, not hidden: an exclusion nobody can see is how a list starts lying.
  for (const [name, reason] of skipped) {
    console.log(`  ${name} … skipped here (${reason})`);
  }
}
console.log(`\nAll ${CHECKS.length} checks passed.`);
