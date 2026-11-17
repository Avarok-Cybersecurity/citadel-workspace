/**
 * The install instructions have exactly one home.
 *
 * They had three: the Mac app's steps in one component, the archive and command in another,
 * and the create-workspace flow's own heading -- each right about a different release. Two
 * checks keep it at one:
 *
 *   - every sentence in AGENT_SETUP_COPY is written in that module and in no other source file;
 *   - only the agent-setup components (and the two modules they read) name a release asset,
 *     the releases page, or the run command.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { AGENT_SETUP_COPY } from '../agent-setup-copy';
import { AGENT_ASSETS, INSTALLER_ASSETS } from '../agent-download';

const SRC: string = join(process.cwd(), 'src');
const COPY_MODULE: string = 'src/lib/agent-setup-copy.ts';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string): string[] => {
    const path: string = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const FILES: ReadonlyMap<string, string> = new Map(
  sources(SRC).map((p: string): [string, string] => [relative(process.cwd(), p).split(sep).join('/'), readFileSync(p, 'utf8')]),
);

/** Leaf strings of the copy, except the archive labels, which are names rather than sentences. */
function sentences(value: unknown, key: string = ''): string[] {
  if (key === 'archiveLabels') return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((v: unknown) => sentences(v));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]: [string, unknown]) => sentences(v, k));
  }
  return [];
}

/**
 * The literal runs of a sentence. Some are templates around an asset name, and the source
 * holds `${LINUX_APPIMAGE_ASSET}` there, so the asset names are cut out of the search.
 */
function literalRuns(sentence: string): string[] {
  const assets: string[] = [...Object.values(AGENT_ASSETS), ...Object.values(INSTALLER_ASSETS).flat()];
  return assets
    .reduce((parts: string[], asset: string) => parts.flatMap((p: string) => p.split(asset)), [sentence])
    .filter((run: string) => run.trim().length >= 12);
}

describe('the install copy', () => {
  const runs: string[] = sentences(AGENT_SETUP_COPY).flatMap(literalRuns);

  it('is found at all', () => {
    // A floor, so a broken walk cannot pass by searching nothing.
    expect(FILES.size).toBeGreaterThan(100);
    expect(FILES.has(COPY_MODULE)).toBe(true);
    expect(runs.length).toBeGreaterThan(20);
  });

  it('is written in the copy module and nowhere else', () => {
    for (const run of runs) {
      const homes: string[] = [...FILES].filter(([, text]) => text.includes(run)).map(([path]) => path);
      expect(homes, `"${run}"`).toEqual([COPY_MODULE]);
    }
  });
});

describe('the downloads', () => {
  const OWNERS: RegExp = /^src\/(components\/agent-setup\/|lib\/agent-download\.ts$|lib\/agent-setup-copy\.ts$)/;
  const NAMES: RegExp = /releases\/latest|\b(AGENT_ASSETS|MAC_APP_ASSET|WINDOWS_INSTALLER_ASSET|LINUX_DEB_ASSET|LINUX_APPIMAGE_ASSET|INSTALLER_ASSETS|releaseAssetUrl|agentDownloadUrl|agentRunCommand|RELEASES_PAGE)\b/;

  it('are named only by the agent-setup components', () => {
    const outside: string[] = [...FILES].filter(([path, text]) => !OWNERS.test(path) && NAMES.test(text)).map(([path]) => path);
    expect(outside).toEqual([]);
  });

  it('are named by them', () => {
    expect([...FILES].some(([path, text]) => /^src\/components\/agent-setup\//.test(path) && NAMES.test(text))).toBe(true);
  });
});
