/**
 * The app's import graph as the bundler sees it, for tests that keep one part of it away from
 * another. Resolves `@/` and relative specifiers to files under src (and beyond, for an entry
 * outside it); a bare specifier is kept as `pkg:<name>` so a test can forbid a package.
 * Type-only imports are erased, as the bundler erases them.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const SRC: string = join(process.cwd(), 'src');

const EXTENSIONS: readonly string[] = ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx'];

function resolveImport(from: string, spec: string): string | null {
  const path: string = spec.split('?')[0];
  const base: string | null = path.startsWith('@/') ? join(SRC, path.slice(2)) : path.startsWith('.') ? resolve(dirname(from), path) : null;
  if (base === null) return null;
  for (const ext of EXTENSIONS) {
    const candidate: string = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Static, value-carrying import and re-export specifiers of a module. */
export function staticImports(source: string): string[] {
  const specs: string[] = [];
  const pattern: RegExp = /^\s*(import|export)\s+(type\s+)?([^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const m of withoutComments(source).matchAll(pattern)) {
    if (m[2] === undefined) specs.push(m[4]);
  }
  return specs;
}

const PROMISE_METHODS: ReadonlySet<string> = new Set<string>(['then', 'catch', 'finally']);

/**
 * Specifiers of `import('…')` calls that load code. A type position (`typeof import('…')`,
 * `: import('…').T`, `<import('…').T>`, or `import('…').T` naming a member that is not a
 * promise method) is erased and is no edge.
 */
export function dynamicImports(source: string): string[] {
  const specs: string[] = [];
  const pattern: RegExp = /(typeof\s+|[:<]\s*)?(?<![\w$.])import\(\s*['"]([^'"]+)['"]\s*\)(\.([\w$]+))?/g;
  for (const m of withoutComments(source).matchAll(pattern)) {
    const typePosition: boolean = m[1] !== undefined || (m[4] !== undefined && !PROMISE_METHODS.has(m[4]));
    if (!typePosition) specs.push(m[2]);
  }
  return specs;
}

/** Every module reachable from `entry`, each mapped to the module that first reached it. */
export function graphFrom(entry: string, follow: (source: string) => string[]): Map<string, string> {
  const parent: Map<string, string> = new Map<string, string>([[entry, '']]);
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const file: string = queue.shift() as string;
    for (const spec of follow(readFileSync(file, 'utf8'))) {
      const target: string = resolveImport(file, spec) ?? (spec.startsWith('.') || spec.startsWith('@/') ? '' : `pkg:${spec}`);
      if (target === '' || parent.has(target)) continue;
      parent.set(target, file);
      if (!target.startsWith('pkg:')) queue.push(target);
    }
  }
  return parent;
}

export const allImports = (source: string): string[] => [...staticImports(source), ...dynamicImports(source)];

const named = (file: string): string => (file.startsWith('pkg:') ? file : relative(SRC, file));

/** The path by which the graph reached `file`, entry first. */
export function chain(parent: Map<string, string>, file: string): string {
  const path: string[] = [];
  for (let at: string = file; at !== ''; at = parent.get(at) ?? '') path.unshift(named(at));
  return path.join(' -> ');
}

/** The chains to every module of the graph `matches` names (relative to src, or `pkg:<name>`). */
export const reaching = (graph: Map<string, string>, matches: (name: string) => boolean): string[] =>
  [...graph.keys()].filter((file: string): boolean => matches(named(file))).map((file: string): string => chain(graph, file));
