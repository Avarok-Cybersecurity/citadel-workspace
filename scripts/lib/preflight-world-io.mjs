/**
 * The world a pass stamp is keyed over (preflight-stamp.mjs): every file of the checkout and its
 * submodules by content, the ignored build outputs the gates read, the installs, the runtimes and
 * the environment. Reads only; the digest is computed by the pure module.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO_LOCATORS } from './preflight-run.mjs';
import { blobId, envInKey, worldDigest } from './preflight-stamp.mjs';


/**
 * Ignored paths the gates read, relative to the parent: the bundle the browser gates serve, the
 * vendored wasm vite serves from public/, and the built client packages the UI resolves through
 * node_modules links (package.json `main` is dist/ in both).
 */
export const WORLD_IGNORED_INPUTS = ['citadel-workspaces/dist', 'citadel-workspaces/public/wasm',
  'citadel-workspace-client-ts/dist', 'citadel-internal-service/typescript-client/dist'];

/** Directories whose `.env*` files vite loads (they are gitignored as `*.local`). */
const ENV_FILE_DIRS = ['citadel-workspaces'];

/** The installs: npm's record of what it put in each node_modules, and what is actually there. */
const NODE_MODULES = ['node_modules', 'citadel-workspaces/node_modules'];

/** Untracked, non-ignored files beyond this are not hashed; stamps are then off for the run. */
export const UNTRACKED_CAP_BYTES = 256 * 1024 * 1024;

const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !REPO_LOCATORS.includes(k)));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: cleanEnv, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const z = (out) => out.split('\0').filter(Boolean);

function contentId(path) {
  const st = lstatSync(path);
  return st.isSymbolicLink() ? blobId(readlinkSync(path)) : blobId(readFileSync(path));
}

/** The checkout's repositories, the parent first, as paths relative to it. */
function repos(root) {
  const out = [''];
  for (const line of git(root, 'submodule', 'status', '--recursive').split('\n').filter(Boolean)) {
    const path = /^[ +\-U]?[0-9a-f]+ (\S+)/.exec(line)?.[1];
    if (!path) throw new Error(`cannot read submodule status line '${line}'`);
    if (line.startsWith('-')) return { unkeyable: `submodule ${path} is not populated` };
    out.push(path);
  }
  return { repos: out };
}

/** One repository's files by content: index ids for clean files, hashed content for the rest. */
function repoEntries(root, repo, entries, budget) {
  const dir = join(root, repo);
  const at = (p) => (repo ? `${repo}/${p}` : p);
  const links = new Set();
  for (const line of z(git(dir, 'ls-files', '-s', '-v', '-z'))) {
    const [, tag, mode, id, stage, path] = /^(\S) (\d+) ([0-9a-f]+) (\d)\t(.*)$/s.exec(line) ?? [];
    if (!path) throw new Error(`cannot read ls-files line in ${dir}`);
    if (stage !== '0') return `${at(path)} is unmerged`;
    // assume-unchanged (a lowercase tag) and skip-worktree (S) hide edits from diff-files: the
    // index id would then stand for content the file no longer has.
    if (tag === 'S' || tag !== tag.toUpperCase()) return `${at(path)} is marked assume-unchanged or skip-worktree`;
    if (mode === '160000') { links.add(path); continue; }
    if (id.length !== 40) throw new Error(`${dir} is not a SHA-1 repository; its index ids cannot be compared with content`);
    entries.set(`file:${at(path)}`, id);
  }
  for (const path of z(git(dir, 'diff-files', '--name-only', '-z'))) {
    if (links.has(path)) continue;
    const full = join(dir, path);
    entries.set(`file:${at(path)}`, existsSync(full) || isLink(full) ? contentId(full) : 'deleted');
  }
  for (const path of z(git(dir, 'ls-files', '-o', '--exclude-standard', '-z'))) {
    if (path.endsWith('/')) return `${at(path)} is an untracked nested repository`;
    budget.bytes += lstatSync(join(dir, path)).size;
    if (budget.bytes > UNTRACKED_CAP_BYTES) return `untracked files exceed ${UNTRACKED_CAP_BYTES / 1048576} MiB`;
    entries.set(`file:${at(path)}`, contentId(join(dir, path)));
  }
  return null;
}

function isLink(path) {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

function walk(root, rel, entries, label) {
  const full = join(root, rel);
  const st = lstatSync(full);
  if (st.isDirectory()) for (const name of readdirSync(full).sort()) walk(root, `${rel}/${name}`, entries, label);
  else entries.set(`${label}:${rel}`, contentId(full));
}

function readOr(path, absent) {
  return existsSync(path) ? readFileSync(path, 'utf8') : absent;
}

/** `rustc -vV` as the gates' PATH resolves it; 'absent' when there is none. Any other failure throws. */
function rustcVersion(env) {
  const runEnv = Object.fromEntries(Object.entries(env).filter(([k, v]) => v !== undefined && !REPO_LOCATORS.includes(k)));
  try {
    return execFileSync('rustc', ['-vV'], { env: runEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().replace(/\n/g, '; ');
  } catch (error) {
    if (error.code === 'ENOENT') return 'absent';
    throw error;
  }
}

/** The installs and the runtimes, as entries. */
function toolchain(root, env, entries) {
  entries.set('tool:node', `${process.version} ${process.platform} ${process.arch}`);
  entries.set('tool:rustc', rustcVersion(env));
  for (const nm of NODE_MODULES) entries.set(`tool:${nm}/.package-lock.json`, blobId(readOr(join(root, nm, '.package-lock.json'), 'absent')));
  const names = new Set();
  for (const pkg of ['package.json', 'citadel-workspaces/package.json']) {
    const json = JSON.parse(readFileSync(join(root, pkg), 'utf8'));
    for (const name of Object.keys({ ...json.dependencies, ...json.devDependencies, ...json.optionalDependencies })) names.add(name);
  }
  names.add('playwright-core');
  for (const name of names) {
    const found = NODE_MODULES.map((nm) => join(root, nm, name, 'package.json')).find(existsSync);
    entries.set(`tool:pkg:${name}`, found ? `${JSON.parse(readFileSync(found, 'utf8')).version} ${relative(root, found)}` : 'absent');
  }
  const browsers = NODE_MODULES.map((nm) => join(root, nm, 'playwright-core', 'browsers.json')).find(existsSync);
  entries.set('tool:playwright-browsers', browsers ? blobId(readFileSync(browsers)) : 'absent');
}

/**
 * The world's digest, or why it cannot be keyed (stamps off; not an error).
 * Throws on any read that fails: an error is never a match.
 * @param {string} root the parent checkout  @param {Record<string, string|undefined>} env
 * @returns {{ digest: string, files: number } | { unkeyable: string }}
 */
export function readWorld(root, env) {
  const entries = new Map();
  const budget = { bytes: 0 };
  const found = repos(root);
  if ('unkeyable' in found) return found;
  for (const repo of found.repos) {
    const why = repoEntries(root, repo, entries, budget);
    if (why) return { unkeyable: why };
  }
  const files = entries.size;
  for (const rel of WORLD_IGNORED_INPUTS) {
    if (existsSync(join(root, rel))) walk(root, rel, entries, 'ignored');
    else entries.set(`ignored:${rel}`, 'absent');
  }
  for (const dir of ENV_FILE_DIRS) {
    for (const name of readdirSync(join(root, dir)).filter((n) => n.startsWith('.env')).sort()) entries.set(`envfile:${dir}/${name}`, contentId(join(root, dir, name)));
  }
  toolchain(root, env, entries);
  for (const [name, value] of envInKey(env)) entries.set(`env:${name}`, value);
  return { digest: worldDigest([...entries]), files };
}
