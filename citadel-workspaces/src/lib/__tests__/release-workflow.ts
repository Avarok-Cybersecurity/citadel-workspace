import { expect } from 'vitest';

/**
 * The file names the publish job releases: every `path:` entry of an upload-artifact step
 * whose artifact name matches the glob the publish job downloads (`pattern: citadel-agent-*`).
 * A step named by `${{ matrix.KEY }}` is expanded once per value of KEY in the workflow, the
 * same value substituted into its paths, as the matrix does.
 */
export function filesThePublishJobCollects(yaml: string): Set<string> {
  const publish: string = yaml.slice(yaml.indexOf('\n  publish:'));
  const glob: string | undefined = /pattern:\s*(\S+)/.exec(publish)?.[1];
  expect(glob, 'the publish job downloads no artifact pattern').toBeDefined();
  const collected: RegExp = new RegExp(`^${(glob ?? '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  const files: Set<string> = new Set();
  for (const step of yaml.split(/\n(?=\s*- (?:uses|name|run|id|if|with|shell):)/)) {
    if (!/uses:\s*actions\/upload-artifact@/.test(step)) continue;
    const withBlock: string = step.slice(Math.max(0, step.indexOf('with:')));
    const name: string | undefined = /\bname:\s*([^\n]+)/.exec(withBlock)?.[1].trim();
    const block: RegExpExecArray | null = /\bpath:\s*(\|[^\n]*\n((?:[ \t]+[^\n]*\n?)*)|[^\n]+)/.exec(withBlock);
    if (name === undefined || block === null) continue;
    const paths: string = block[2] ?? block[1];
    const matrixKey: string | undefined = /\$\{\{\s*matrix\.(\w+)\s*\}\}/.exec(name)?.[1];
    const rows: [string, string][] = matrixKey === undefined
      ? [[name, paths]]
      : [...yaml.matchAll(new RegExp(`^\\s*-?\\s*${matrixKey}:\\s*(\\S+)\\s*$`, 'gm'))].map((m): [string, string] => {
        const sub = (text: string): string => text.replace(new RegExp(`\\$\\{\\{\\s*matrix\\.${matrixKey}\\s*\\}\\}`, 'g'), m[1]);
        return [sub(name), sub(paths)];
      });
    for (const [artifact, list] of rows) {
      if (!collected.test(artifact)) continue;
      // The block scalar ends where the next key (`if-no-files-found:`) begins.
      for (const line of list.split('\n').filter((l: string) => !/^[\w-]+:/.test(l.trim()))) {
        const file: string | undefined = line.trim().split('/').pop();
        if (file) files.add(file);
      }
    }
  }
  return files;
}
