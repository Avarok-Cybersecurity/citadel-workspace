/**
 * The shipped Docs harness (scripts/lib/docs-harness) builds with no WASM client present, as
 * the Docs crispness and scroll-frame checks build it (SKIP_WASM_BUILD=1). So nothing it
 * reaches may load the connection layer or the clients under it, even through import(): the
 * bundler follows a dynamic import as surely as a static one. The agent-held key reaches
 * encryption at rest through a port the app wires at boot (lib/at-rest/root-store-port.ts).
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { SRC, allImports, dynamicImports, graphFrom, reaching } from './import-graph';

const HARNESS: string = join(process.cwd(), 'scripts/lib/docs-harness/main.tsx');

const CONNECTION_LAYER: readonly RegExp[] = [
  /^lib\/connection\//,
  /^lib\/websocket-service(\.ts|\/)/,
  /^pkg:citadel-internal-service-wasm-client/,
  /^pkg:citadel-workspace-client-ts/,
];
const isConnectionLayer = (name: string): boolean => CONNECTION_LAYER.some((re: RegExp): boolean => re.test(name));

describe('the Docs harness never reaches the agent', () => {
  const graph: Map<string, string> = graphFrom(HARNESS, allImports);
  const names: string[] = [...graph.keys()].map((file: string): string => file.replace(`${SRC}/`, ''));

  it('walks the real graph, through the lazy doors and the device-records seam', () => {
    expect(names).toEqual(expect.arrayContaining([
      'components/documents/DocumentHost.tsx',
      'components/documents/DocsCanvas.tsx',
      'lib/document-replica-cache.ts',
      'lib/at-rest/at-rest-records.ts',
      'lib/at-rest/root-store-port.ts',
    ]));
  });

  it('reaches no connection layer, websocket service or client package, statically or dynamically', () => {
    expect(reaching(graph, isConnectionLayer)).toEqual([]);
  });

  it('reaches no store for the agent-held key: the app wires it, the harness never does', () => {
    expect(reaching(graph, (name: string): boolean => name === 'lib/at-rest/agent-root-store.ts')).toEqual([]);
  });

  it('reads loading import() as an edge and type-position import() as erased', () => {
    const source: string = [
      "const a = await import('./a');",
      "lazy(() => import('./b'));",
      "import('./c').then(go);",
      "type T = typeof import('./d');",
      "let e: import('./e').E;",
      "const f: Promise<import('./f').F> = load();",
      "import('./g').Thing;",
    ].join('\n');
    expect(dynamicImports(source)).toEqual(['./a', './b', './c']);
  });
});
