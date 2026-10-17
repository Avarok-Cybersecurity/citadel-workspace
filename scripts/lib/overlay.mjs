/**
 * A throwaway copy of the workspace at chosen commits, cheap enough to make per push.
 *
 * Each repo is a `git clone --shared` of this clone's own repo: its objects are borrowed through
 * alternates, nothing is written into the source repository, and deleting the directory is the
 * whole cleanup. No Rust target directory is created -- the overlay never runs cargo builds,
 * because two source trees with the same crate names sharing one target link each other's
 * crates (see the memory note on shared target dirs), and a target per overlay costs gigabytes.
 *
 * node_modules is an overlay too: a real directory of symlinks into this clone's install, except
 * the workspace packages, which point at the overlay's own sources. npm must never run in it --
 * a symlinked tree lets npm write straight through into the clone's packages.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const UI_DIR = 'citadel-workspaces';
export const AGENT_DIR = 'citadel-internal-service';
const ILM_DIR = 'intersession-layer-messaging';
const TSC_CLIENT = 'citadel-internal-service/typescript-client';
const CLIENT_TS = 'citadel-workspace-client-ts';

export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Whether `sha` is an object the repo at `cwd` can read. */
export function hasCommit(cwd, sha) {
  try {
    git(cwd, 'cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

export function makeScratch(label) {
  // realpath: tmpdir() is /var/... on macOS, a symlink to /private/var, and tools print the real one.
  return realpathSync(mkdtempSync(join(tmpdir(), `citadel-${label}-`)));
}

/** A shared, unchecked-out clone of `source` at `dest`, with `origin` pointing where the source's does. */
export function sharedClone(source, dest) {
  mkdirSync(dest, { recursive: true });
  git(dest, 'clone', '--quiet', '--shared', '--no-checkout', source, '.');
  git(dest, 'remote', 'set-url', 'origin', git(source, 'remote', 'get-url', 'origin'));
}

/** Makes `sha` readable in `repo`, fetching it from origin when the borrowed objects lack it. */
export function ensureCommit(repo, sha) {
  if (hasCommit(repo, sha)) return;
  git(repo, 'fetch', '--quiet', 'origin', sha);
  if (!hasCommit(repo, sha)) throw new Error(`${sha} is not on ${git(repo, 'remote', 'get-url', 'origin')}`);
}

export function checkout(repo, sha) {
  git(repo, 'checkout', '--quiet', '--detach', sha);
}

/** Points the parent overlay's gitlink at `sha` and commits it, so pointer-reading gates agree with the checkout. */
export function recordPointer(parent, path, sha, message) {
  git(parent, 'update-index', '--cacheinfo', `160000,${sha},${path}`);
  git(parent, '-c', 'user.name=merge-preview', '-c', 'user.email=merge-preview@localhost', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', message);
}

/** Recreates `source`'s node_modules entries in `dest`: relative links (workspace packages) as-is, the rest as absolute links. */
function linkModules(source, dest) {
  if (!existsSync(source)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(source)) {
    const from = join(source, entry);
    const stat = lstatSync(from);
    const target = stat.isSymbolicLink() ? readlinkSync(from) : null;
    symlinkSync(target !== null && !target.startsWith('/') ? target : from, join(dest, entry));
  }
}

/**
 * Everything a TypeScript build needs that git does not hold: the installs, and the wasm-pack
 * glue under typescript-client (generated from the Rust, untracked). The glue is this clone's;
 * an overlay whose agent changed the Rust is typechecked against the old glue, which is the one
 * thing it cannot rebuild without wasm-pack.
 */
export function prepareTypeScript(root, dir) {
  linkModules(join(root, 'node_modules'), join(dir, 'node_modules'));
  for (const pkg of [CLIENT_TS, TSC_CLIENT]) linkModules(join(root, pkg, 'node_modules'), join(dir, pkg, 'node_modules'));
  const glue = join(root, TSC_CLIENT);
  for (const file of readdirSync(glue).filter((f) => f.startsWith('citadel_internal_service_wasm_client'))) {
    cpSync(join(glue, file), join(dir, TSC_CLIENT, file));
  }
}

/** The tsc invocations that build the two client packages, then typecheck the UI, in the overlay. */
export function typeScriptSteps(root, dir) {
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  return [
    ['build typescript-client', ['node', tsc, '-p', join(dir, TSC_CLIENT, 'tsconfig.json')]],
    ['build citadel-workspace-client-ts', ['node', tsc, '-p', join(dir, CLIENT_TS, 'tsconfig.json')]],
    ['typecheck the UI', ['node', tsc, '-p', join(dir, UI_DIR, 'tsconfig.app.json'), '--noEmit']],
  ];
}

/**
 * Builds the overlay: the parent at `parentSha`, the UI and agent at the commits given (null:
 * whatever the parent records), the agent's ILM at whatever the agent records.
 */
export function buildOverlay({ root, dir, parentSha, uiSha, agentSha }) {
  sharedClone(root, dir);
  ensureCommit(dir, parentSha);
  checkout(dir, parentSha);
  return attachSubmodules(root, dir, uiSha, agentSha);
}

/** The UI, agent and ILM shared clones inside a checked-out parent overlay. */
export function attachSubmodules(root, dir, uiSha, agentSha) {
  const ui = uiSha ?? git(dir, 'rev-parse', `HEAD:${UI_DIR}`);
  const agent = agentSha ?? git(dir, 'rev-parse', `HEAD:${AGENT_DIR}`);
  attach(join(root, UI_DIR), join(dir, UI_DIR), ui);
  attach(join(root, AGENT_DIR), join(dir, AGENT_DIR), agent);
  attachIlm(root, dir);
  return { ui, agent };
}

/** The ILM the overlay's agent records -- again after the agent moves. */
export function attachIlm(root, dir) {
  const ilm = git(join(dir, AGENT_DIR), 'rev-parse', `HEAD:${ILM_DIR}`);
  attach(join(root, AGENT_DIR, ILM_DIR), join(dir, AGENT_DIR, ILM_DIR), ilm);
}

/** A submodule's shared clone, at `sha`, inside the overlay. */
export function attach(source, dest, sha) {
  rmSync(dest, { recursive: true, force: true });
  sharedClone(source, dest);
  ensureCommit(dest, sha);
  checkout(dest, sha);
}

export function removeScratch(dir) {
  rmSync(dir, { recursive: true, force: true });
  if (existsSync(dir)) throw new Error(`could not remove ${dir}`);
}
