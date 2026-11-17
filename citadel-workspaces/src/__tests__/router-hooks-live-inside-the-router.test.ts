/**
 * Nothing rendered above <BrowserRouter> may use a router hook.
 *
 * `OngoingCallBar` calls `useNavigate()` — its whole purpose is a Return
 * button — and was mounted inside `CallLayer`, which sits ABOVE the router so
 * that a call survives navigation. Hooks run before a component's early
 * returns, so it threw react-router's "useNavigate() may be used only in the
 * context of a <Router>" on every render, with no call in progress and no bar
 * on screen.
 *
 * That took the entire application down. Every load — production and dev —
 * rendered the root error boundary's "Something went wrong" instead of the
 * app. Two production browser checks reported a mounted app throughout,
 * because both asked only whether `#root` had children and the error boundary
 * is a child of `#root`.
 *
 * A unit test rather than a browser check because the browser checks are the
 * ones that missed it, and because this is a static property of the tree: a
 * component above the router either reaches a router hook or it does not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SRC: string = resolve(__dirname, '..');
const ROUTER_HOOKS: RegExp = /\buse(Navigate|Location|Params|SearchParams|NavigationType|Match|Routes|Resolved(Path)?|OutletContext)\s*\(/;

/** Component names rendered before <BrowserRouter> opens in App.tsx. */
function componentsAboveTheRouter(): string[] {
  const app: string = readFileSync(join(SRC, 'App.tsx'), 'utf8');
  const start: number = app.indexOf('<AppErrorBoundary>');
  const router: number = app.indexOf('<BrowserRouter');
  expect(start).toBeGreaterThan(-1);
  expect(router).toBeGreaterThan(start);
  const above: string = app.slice(start, router);
  // JSX comments are where the reasoning lives and mention component names in
  // prose; strip them or the rule reads its own explanation as a render.
  const code: string = above.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  return [...new Set([...code.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
}

/** Resolve an import specifier to a file under src/, or null. */
function resolveLocal(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return existsSync(base) ? base : null;
}

/**
 * Source with comments removed.
 *
 * The first run of this rule flagged CallLayer.tsx — for the comment
 * explaining why the bar was moved out of it, which names `useNavigate()`. A
 * rule that reads its own documentation as a violation makes writing the
 * documentation a bug.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every src/ file reachable from `entry` by import, entry included. */
function reachable(entry: string): string[] {
  const seen: Set<string> = new Set<string>();
  const queue: string[] = [entry];
  while (queue.length) {
    const file: string | undefined = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const text: string = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const next: string | null = resolveLocal(file, m[1]);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen];
}

describe('components mounted above the router', () => {
  const above: string[] = componentsAboveTheRouter();

  it('finds the components, so the rule is not passing over an empty list', () => {
    // Every guard in this repo that silently checked nothing looked exactly
    // like a passing one. If App.tsx is restructured, fail here rather than
    // report a clean run over nothing.
    expect(above.length).toBeGreaterThanOrEqual(3);
    expect(above).toContain('CallLayer');
  });

  it('reach no router hook', () => {
    const app: string = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    const imports: Map<string, string> = new Map<string, string>();
    for (const m of app.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
      for (const name of m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()!)) {
        imports.set(name, m[2]);
      }
    }

    const offenders: string[] = [];
    for (const name of above) {
      const spec: string | undefined = imports.get(name);
      if (!spec) continue;
      const entry: string | null = resolveLocal(join(SRC, 'App.tsx'), spec);
      if (!entry) continue;
      for (const file of reachable(entry)) {
        if (ROUTER_HOOKS.test(code(file))) {
          offenders.push(`${name} → ${file.slice(SRC.length + 1)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
