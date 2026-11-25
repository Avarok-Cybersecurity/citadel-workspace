/**
 * git for scratch repositories that tests and gates build in a temp directory: one helper, so no
 * outer option can aim them at a real remote.
 *
 * git hands `-c` options to every child git (GIT_CONFIG_PARAMETERS, GIT_CONFIG_COUNT/KEY_n/VALUE_n).
 * A push run as `git -c remote.origin.pushurl=https://github.com/… push` therefore re-aimed the
 * scratch pushes of the hook's own tests at the real repository, with the credential helper
 * inherited. Here every GIT_* variable is dropped (a hook's GIT_DIR or GIT_INDEX_FILE would also point
 * them at the developer's repo), global and system config are off, and the scratch's own settings
 * travel by GIT_CONFIG_COUNT so they reach grandchildren too: no credential helper, and no transport
 * except local files. On top of that, `push` is refused unless its target is a path inside the
 * scratch directory.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

export const SCRATCH_CONFIG = [
  ['credential.helper', ''],
  ['protocol.allow', 'never'],
  ['protocol.file.allow', 'always'],
  ['commit.gpgsign', 'false'],
  ['tag.gpgsign', 'false'],
  ['user.name', 'scratch'],
  ['user.email', 'scratch@localhost'],
];

/** The environment for a scratch git and anything it spawns (pure). */
export function scratchEnv(env) {
  const out = Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')));
  out.GIT_CONFIG_GLOBAL = '/dev/null';
  out.GIT_CONFIG_NOSYSTEM = '1';
  out.GIT_TERMINAL_PROMPT = '0';
  out.GIT_CONFIG_COUNT = String(SCRATCH_CONFIG.length);
  SCRATCH_CONFIG.forEach(([key, value], i) => { out[`GIT_CONFIG_KEY_${i}`] = key; out[`GIT_CONFIG_VALUE_${i}`] = value; });
  return out;
}

/**
 * Why a push to `target` (a URL or path, resolved from `cwd`) must not run, or null (pure).
 * `canonical` maps a local path to its real path (symlinks such as /var -> /private/var resolved).
 */
export function pushTargetProblem({ target, cwd, scratchRoot, canonical }) {
  const path = target.startsWith('file://') ? target.slice('file://'.length) : target;
  const local = isAbsolute(path) || path.startsWith('.') || !/^[a-z+]+:|^[^/]+@[^/]+:/i.test(path);
  if (!local) return `refusing to push from a scratch repository to ${target}: not a local path`;
  const full = canonical(resolve(cwd, path));
  if (full !== scratchRoot && !full.startsWith(scratchRoot + sep)) return `refusing to push from a scratch repository to ${target}: outside ${scratchRoot}`;
  return null;
}

/** git's subcommand in an argument list: the first argument after the global options. */
export function subcommandAt(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-c' || args[i] === '-C') { i += 1; continue; }
    if (!args[i].startsWith('-')) return i;
  }
  return -1;
}

/** The repository a `git push …` names: its first positional argument, else origin (pure). */
export function pushedRemote(args) {
  return args.slice(subcommandAt(args) + 1).find((a) => !a.startsWith('-')) ?? 'origin';
}

const realPathOrSelf = (path) => (existsSync(path) ? realpathSync(path) : path);

/** `git` confined to `root` (a directory the caller created with mkdtemp). */
export function scratchGit(root) {
  const scratchRoot = realpathSync(root);
  const env = scratchEnv(process.env);
  const raw = (cwd, args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const git = (cwd, ...args) => {
    const here = realpathSync(cwd);
    if (here !== scratchRoot && !here.startsWith(scratchRoot + sep)) throw new Error(`scratch git ran outside ${scratchRoot}: ${here}`);
    if (args.includes('-C')) throw new Error('scratch git takes its directory as cwd, never -C');
    if (args[subcommandAt(args)] === 'push') {
      const remote = pushedRemote(args);
      let target = remote;
      try { target = raw(here, ['remote', 'get-url', '--push', remote]); } catch { /* not a remote name: a path or URL */ }
      const problem = pushTargetProblem({ target, cwd: here, scratchRoot, canonical: realPathOrSelf });
      if (problem) throw new Error(problem);
    }
    return raw(here, args);
  };
  return { git, env, root: scratchRoot };
}

/** A test process that hands scratch repositories to production code: its own git children get the scratch environment. */
export function adoptScratchEnv(env) {
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  Object.assign(env, scratchEnv({}));
}
