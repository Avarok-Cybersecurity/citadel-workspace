/**
 * Which checks a change set needs, decided from the paths alone. Pure.
 *
 * Paths are relative to the repository root (the UI lives at citadel-workspaces/; it was a
 * separate repository whose hooks prefixed their paths, until it was folded in).
 *
 *   ui         anything under citadel-workspaces/, or the client-ts package it imports
 *   rust:root  a .rs / Cargo file of the parent's cargo workspace
 *   rust:agent the agent submodule (its pointer, from the parent's side)
 *   parent     the parent's own scripts, workflows, docs, package files
 *
 * A path that matches nothing is not dropped: it lands in `parent`, whose gates are the ones
 * that read the repository at large. Unknown means "check more", never "check nothing".
 */
import { readsPath } from './ui-test-reads.mjs';

export const UI = 'citadel-workspaces';
export const AGENT = 'citadel-internal-service';
export const CLIENT_TS = 'citadel-workspace-client-ts';

const RUST_FILE = /(\.rs|(^|\/)Cargo\.(toml|lock)|(^|\/)rust-toolchain(\.toml)?)$/;

/** The tiers a set of changed paths touches. */
export function tiersFor(paths, rootCrateDirs) {
  const tiers = new Set();
  for (const path of paths) {
    if (path.startsWith(`${UI}/`) || path.startsWith(`${CLIENT_TS}/`)) tiers.add('ui');
    else if (path === AGENT || path.startsWith(`${AGENT}/`)) tiers.add('rust:agent');
    else if (RUST_FILE.test(path) && (path === 'Cargo.toml' || path === 'Cargo.lock' || rootCrateDirs.some((d) => path.startsWith(`${d}/`)))) tiers.add('rust:root');
    else tiers.add('parent');
    // The client package is UI input AND a parent script target (its tests run in the lint job).
    if (path.startsWith(`${CLIENT_TS}/`)) tiers.add('parent');
  }
  return tiers;
}

/** The crate directory a Rust path belongs to: the deepest listed directory containing it. */
export function crateOf(path, crateDirs) {
  return crateDirs.filter((d) => path.startsWith(`${d}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
}

/**
 * Whether a static gate reads the area a path lives in.
 *
 * A gate script names what it reads -- `join(ROOT, 'citadel-workspaces', 'src')`,
 * `.github/workflows`, `citadel-workspace-server-kernel` -- so a gate is relevant to a change
 * when its own source mentions the change's top-level directory, or the changed file itself is
 * the gate. A gate that reads everything through `git ls-files` names no directory; those are
 * matched by the `wholeRepo` flag the caller computes, and always run.
 */
export function gateIsRelevant({ script, source, cwdArea, wholeRepo, browser }, paths) {
  if (typeof browser !== 'boolean') throw new Error(`gate ${script}: relevance.browser must be true or false`);
  if (wholeRepo) return true;
  return paths.some((path) => {
    if (path === script) return true;
    const top = path.split('/')[0];
    if (cwdArea !== null && top === cwdArea) return true;
    // A static gate costs ~0.1 s in parallel, so a wide match is free and a narrow one was tried:
    // it dropped `doc file refs` (it walks from '.') and `sync image has its scripts` (it follows
    // the paths another script names) off directories they read. A browser gate costs minutes and
    // reads citadel-workspaces/ through its harness or dist/, so it gets the whole-name match.
    return browser ? namesTopLevel(source, top) : source.includes(top);
  });
}

/**
 * Whether a source names `top` as a whole name, not as part of a longer one: "docs" inside
 * `citadel-docs`, `docs-harness` or `cdocs` is a different name, and once put four browser gates
 * on every docs-only commit. Anything else counts, prose included: an extra gate costs seconds,
 * a missed one is a hole. Used for browser gates only (gateIsRelevant says why). Matching only
 * quoted path starts was tried first and dropped 1.1 k of 12.6 k gate/directory pairs.
 */
export function namesTopLevel(source, top) {
  const name = top.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_-])${name}(?![A-Za-z0-9_-])`).test(source);
}

/** Whether a gate's source reads the whole repository rather than a named part of it. */
export function readsWholeRepo(source) {
  return /git['"`,\s]+\[?\s*['"`]?ls-files|git ls-files|readdirSync\(\s*ROOT\s*[,)]|\(\s*['"]\.['"]\s*[,)]/.test(source);
}

/**
 * The checks one hook runs.
 *
 * `checks` carry `tiers` (the change tiers they belong to) and, for derived static gates,
 * `relevance` (`{ script, source, cwdArea, wholeRepo }`). `push` checks run on every pre-push;
 * `env` checks run everywhere. A derived static gate runs in a hook when the changed paths are
 * relevant to it, or -- on pre-push -- when its tier was touched at all.
 */
export function selectChecks(checks, hook, paths, rootCrateDirs) {
  if (hook === 'full') return checks.filter((c) => !c.tiers.has('pre-commit-only'));
  const touched = tiersFor(paths, rootCrateDirs);
  return checks.filter((c) => {
    if (c.tiers.has('env')) return true;
    if (c.tiers.has('pre-commit-only')) return hook === 'pre-commit';
    if (c.tiers.has('push')) return hook === 'pre-push';
    if (hook === 'pre-commit' && c.tiers.has('not-pre-commit')) return false;
    if (c.relevance) {
      if (gateIsRelevant(c.relevance, paths)) return true;
      return hook === 'pre-push' && [...c.tiers].some((t) => touched.has(t));
    }
    // `reads`: paths outside its tier that a check also reads (the UI's unit tests read the contracts beside it).
    return hook === 'pre-push' && ([...c.tiers].some((t) => touched.has(t)) || (c.reads !== undefined && paths.some((p) => readsPath(c.reads, p))));
  });
}
