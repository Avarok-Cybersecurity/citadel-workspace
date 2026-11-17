/**
 * The routes an InternalHttpServer advertises (R4.4): method + path pattern, at most `maxRoutes`.
 * A pattern is `/`-separated literal segments, `:name` for exactly one segment, and an optional
 * final `*` for the rest. Anything else is refused when the app calls `ihttp.serve`, so a route
 * table that reaches the router is always well-formed.
 */
import { isCborMap } from './cbor';
import { IHTTP_METHODS } from './ihttp-common';

export interface RoutePattern {
  readonly method: string;
  readonly segments: readonly string[];
}

export type ParsedRoutes = { readonly ok: true; readonly routes: readonly RoutePattern[] } | { readonly ok: false; readonly reason: string };

const LITERAL: RegExp = /^[A-Za-z0-9._~-]+$/;
/** Answered by the host itself, never an app: citadel-ihttp-types RESERVED_PATH_PREFIX, whose routes the manifest check refuses too. */
export const RESERVED_SEGMENT: string = '_citadel';
const PARAM: RegExp = /^:[a-z][a-z0-9_]*$/;

function parsePattern(path: string, maxPathBytes: number): readonly string[] | null {
  if (!path.startsWith('/') || new TextEncoder().encode(path).byteLength > maxPathBytes) return null;
  const segments: string[] = path === '/' ? [] : path.slice(1).split('/');
  if (segments[0] === RESERVED_SEGMENT) return null;
  const ok: boolean = segments.every((s: string, i: number) =>
    LITERAL.test(s) || PARAM.test(s) || (s === '*' && i === segments.length - 1));
  return ok ? segments : null;
}

/** `[{method, path}]` from the app's CBOR, or why not. */
export function parseRoutes(raw: unknown, maxRoutes: number, maxPathBytes: number): ParsedRoutes {
  if (!Array.isArray(raw)) return { ok: false, reason: 'routes must be a list' };
  if (raw.length === 0 || raw.length > maxRoutes) return { ok: false, reason: `between 1 and ${maxRoutes} routes` };
  const routes: RoutePattern[] = [];
  for (const item of raw as unknown[]) {
    if (!isCborMap(item) || typeof item.method !== 'string' || typeof item.path !== 'string') return { ok: false, reason: 'a route is {method, path}' };
    if (!IHTTP_METHODS.has(item.method)) return { ok: false, reason: `method ${item.method}` };
    const segments: readonly string[] | null = parsePattern(item.path, maxPathBytes);
    if (segments === null) return { ok: false, reason: `path pattern ${item.path}` };
    routes.push({ method: item.method, segments });
  }
  return { ok: true, routes };
}

function matches(route: RoutePattern, method: string, segments: readonly string[]): boolean {
  if (route.method !== method) return false;
  const rest: boolean = route.segments[route.segments.length - 1] === '*';
  const fixed: number = rest ? route.segments.length - 1 : route.segments.length;
  if (rest ? segments.length < fixed : segments.length !== fixed) return false;
  for (let i: number = 0; i < fixed; i++) {
    const want: string = route.segments[i];
    if (want.startsWith(':')) {
      if (segments[i] === '') return false;
    } else if (want !== segments[i]) return false;
  }
  return true;
}

/** The first route that admits this request, or null. A path is matched as given: no decoding. */
export function matchRoute(routes: readonly RoutePattern[], method: string, path: string): RoutePattern | null {
  if (!path.startsWith('/')) return null;
  const segments: readonly string[] = path === '/' ? [] : path.slice(1).split('/');
  if (segments.some((s: string) => s === '..' || s === '.')) return null;
  return routes.find((r: RoutePattern) => matches(r, method, segments)) ?? null;
}
