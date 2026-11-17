import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_ASSETS,
  INSTALLER_ASSETS,
  MAC_APP_ASSET,
  agentDownloadUrl,
  agentPlatformCandidates,
  agentRunCommand,
  type AgentPlatform,
} from '../agent-download';
import { filesThePublishJobCollects } from './release-workflow';

const WORKFLOW: string = join(process.cwd(), '..', '.github', 'workflows', 'release-agent.yml');
/** The agent's CLI, as the agent itself declares it. */
const AGENT_MAIN: string = join(
  process.cwd(), '..', 'citadel-workspace-internal-service', 'src', 'main.rs',
);

/** What the packaged agents start with: the one source the launchers render from. */

const nav: (platform: string, userAgent: string, maxTouchPoints?: number) => Navigator = (platform: string, userAgent: string, maxTouchPoints = 0): Navigator =>
  ({ platform, userAgent, maxTouchPoints }) as unknown as Navigator;

describe('agent asset names match the release workflow', () => {
  it('finds the workflow', () => {
    // If this file moves, every assertion below would pass vacuously by
    // matching nothing at all.
    expect(existsSync(WORKFLOW)).toBe(true);
  });

  it('every asset the UI links to is built and published by the workflow', () => {
    const yaml: string = readFileSync(WORKFLOW, 'utf8');
    const published: Set<string> = new Set(
      [...yaml.matchAll(/asset:\s*(citadel-agent-[\w.-]+)/g)].map((m) => m[1]),
    );
    // Guard against the regex silently matching nothing.
    expect(published.size).toBeGreaterThanOrEqual(4);

    for (const [platform, asset] of Object.entries(AGENT_ASSETS)) {
      expect(
        published.has(asset),
        `The UI offers "${asset}" for ${platform}, but release-agent.yml builds no such asset. ` +
          `A user clicking that link gets a 404 from GitHub. Published: ${[...published].join(', ')}`,
      ).toBe(true);
    }
  });

  it('the Mac app is built by the macos-app job', () => {
    const yaml: string = readFileSync(WORKFLOW, 'utf8');
    const job: string = yaml.slice(yaml.indexOf('\n  macos-app:'), yaml.indexOf('\n  publish:'));
    expect(job.length, 'release-agent.yml has no macos-app job before publish').toBeGreaterThan(0);
    expect(job).toContain(`package-macos-dmg.sh "$RUNNER_TEMP/app/Citadel Agent.app" ${MAC_APP_ASSET}`);
  });

  it('every one-click installer the UI links to is uploaded where the publish job collects it', () => {
    // Needs the pipeline change that builds the .msi, .deb and AppImage: until it lands in
    // release-agent.yml, the three are linked from the page and 404 on click.
    const yaml: string = readFileSync(WORKFLOW, 'utf8');
    const published: Set<string> = filesThePublishJobCollects(yaml);
    // A floor: the parse finding nothing would make every assertion below fail for the
    // wrong reason, and a parse finding only the .sha256 files would too.
    expect(published.has(MAC_APP_ASSET), `parsed: ${[...published].join(', ')}`).toBe(true);
    expect(published.has(AGENT_ASSETS['linux-x64']), `matrix not expanded: ${[...published].join(', ')}`).toBe(true);
    for (const asset of Object.values(INSTALLER_ASSETS).flat()) {
      expect(
        published.has(asset),
        `The UI offers "${asset}", but no upload-artifact step the publish job collects carries it. ` +
          `Collected: ${[...published].join(', ')}`,
      ).toBe(true);
    }
  });

  it('the workflow publishes nothing the UI cannot offer', () => {
    const yaml: string = readFileSync(WORKFLOW, 'utf8');
    const published: string[] = [...yaml.matchAll(/asset:\s*(citadel-agent-[\w.-]+)/g)].map((m) => m[1]);
    const offered: Set<string> = new Set(Object.values(AGENT_ASSETS));
    for (const asset of published) {
      expect(
        offered.has(asset),
        `release-agent.yml builds "${asset}" but no platform in AGENT_ASSETS offers it, ` +
          `so it is built, uploaded, and unreachable from the app.`,
      ).toBe(true);
    }
  });
});

describe('the run command only uses flags the agent has', () => {
  /**
   * Every `--flag` this page tells a stranger to paste must exist.
   *
   * It did not. `agentRunCommand` appended `--loopback-host` and
   * `--loopback-cert-url`, and the agent has never had either:
   *
   *   error: Found argument '--loopback-host' which wasn't expected
   *
   * and it refuses to start. Both were appended ONLY when a loopback origin is
   * published -- which is the hosted deployment and nowhere else -- so the
   * command was unrunnable in the one place it is the instruction a stranger
   * follows, and runnable everywhere it is not.
   *
   * The tests in this file pinned those flags, so the broken command was
   * correct according to its own suite. Read from the agent's own `main.rs`
   * rather than a list kept here, because a list kept here is the thing that
   * drifted.
   */
  const cliFlags = (): Set<string> => {
    const source: string = readFileSync(AGENT_MAIN, 'utf8');
    const struct: string = source.slice(source.indexOf('#[structopt('));
    return new Set(
      [...struct.matchAll(/^\s{4}([a-z][a-z0-9_]*)\s*:/gm)].map((m) => m[1].replace(/_/g, '-')),
    );
  };

  it('finds the agent CLI', () => {
    // A floor. Without it every assertion below passes by matching nothing.
    expect(existsSync(AGENT_MAIN)).toBe(true);
    const flags: Set<string> = cliFlags();
    expect(flags.has('bind')).toBe(true);
    expect(flags.has('allowed-origins')).toBe(true);
    expect(flags.size).toBeGreaterThan(4);
  });

  it('every flag in every command it can produce is a real one', () => {
    const flags: Set<string> = cliFlags();
    const platforms: AgentPlatform[] = ['macos-arm64', 'macos-x64', 'linux-x64', 'windows-x64'];
    for (const platform of platforms) {
      for (const loopbackOrigin of [undefined, 'wss://local.example.com:12345']) {
        const command: string = agentRunCommand({
          platform,
          pageOrigin: 'https://work.example.com',
          loopbackOrigin,
        });
        const used: string[] = [...command.matchAll(/--([a-z][a-z0-9-]*)/g)].map((m) => m[1]);
        expect(used.length).toBeGreaterThan(0);
        for (const flag of used) {
          expect(flags, `${platform} / loopback=${String(loopbackOrigin)}: --${flag}`).toContain(flag);
        }
      }
    }
  });
});

describe('platform candidates', () => {
  it('offers a single build for Windows and Linux', () => {
    expect(agentPlatformCandidates(nav('Win32', 'Mozilla/5.0 (Windows NT 10.0)'))).toEqual(['windows-x64']);
    expect(agentPlatformCandidates(nav('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)'))).toEqual(['linux-x64']);
  });

  it('offers BOTH mac builds rather than guessing the architecture', () => {
    // Apple Silicon reports MacIntel, so a single answer here would be wrong
    // half the time — and wrong only after the download finishes.
    const macs: AgentPlatform[] = agentPlatformCandidates(nav('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'));
    expect(macs).toEqual(['macos-arm64', 'macos-x64']);
  });

  it('offers nothing on phones and tablets, which cannot run the agent', () => {
    expect(agentPlatformCandidates(nav('iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'))).toEqual([]);
    expect(agentPlatformCandidates(nav('Linux armv8l', 'Mozilla/5.0 (Linux; Android 14)'))).toEqual([]);
    // iPadOS claims to be a desktop Mac; touch points are the tell.
    expect(agentPlatformCandidates(nav('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5))).toEqual([]);
  });

  it('offers nothing when the platform is unrecognisable', () => {
    expect(agentPlatformCandidates(nav('', ''))).toEqual([]);
  });
});

describe('download URLs', () => {
  it('point at /releases/latest/download so no API call or token is needed', () => {
    for (const platform of Object.keys(AGENT_ASSETS) as AgentPlatform[]) {
      const url: string = agentDownloadUrl(platform);
      expect(url).toContain('/releases/latest/download/');
      expect(url.endsWith(AGENT_ASSETS[platform])).toBe(true);
      expect(url.startsWith('https://')).toBe(true);
    }
  });
});

describe('the run command the hint shows', () => {
  const page: string = 'https://work.example.com';
  const loopback: string = 'wss://local.example.com:12345';

  it('names the binary the release workflow packages, not the crate', () => {
    // release-agent.yml copies the built binary to "$staging/citadel-agent"; the archive a
    // visitor unpacks contains THAT name. A command naming anything else is unrunnable.
    const yaml: string = readFileSync(WORKFLOW, 'utf8');
    const packaged: string | undefined = /\$staging\/(citadel-agent)"/.exec(yaml)?.[1];
    expect(packaged, 'release-agent.yml no longer packages the binary as citadel-agent').toBe('citadel-agent');
    expect(agentRunCommand({ platform: 'linux-x64', pageOrigin: page, loopbackOrigin: undefined })).toMatch(/^\.\/citadel-agent /);
    expect(agentRunCommand({ platform: 'windows-x64', pageOrigin: page, loopbackOrigin: undefined })).toMatch(/^\.\\citadel-agent\.exe /);
  });

  it('allows exactly the page that shows it, and carries both flags that have no safe default', () => {
    const cmd: string = agentRunCommand({ platform: 'macos-arm64', pageOrigin: page, loopbackOrigin: undefined });
    expect(cmd).toContain('--bind 127.0.0.1:12345');
    expect(cmd).toContain('--backend filesystem');
    expect(cmd).toContain(`--allowed-origins ${page}`);
    expect(cmd).not.toContain('--loopback');
  });

  it('adds the loopback name and the certificate URL when the page published a loopback origin', () => {
    const cmd: string = agentRunCommand({ platform: 'linux-x64', pageOrigin: page, loopbackOrigin: loopback });
    // These flags do not exist. The agent's entire CLI is --bind, --backend,
    // --data-dir, --allowed-origins, --tls-cert, --tls-key, --no-tls and
    // --dangerous; it answers either of these with "Found argument
    // '--loopback-host' which wasn't expected" and refuses to start. They were
    // emitted ONLY when a loopback origin is published -- the hosted
    // deployment, and nowhere else -- so the command was unrunnable in the one
    // place it is the instruction a stranger follows.
    //
    // This test asserted them, which is how a broken command stayed correct
    // according to its own suite.
    expect(cmd).not.toContain('--loopback-host');
    expect(cmd).not.toContain('--loopback-cert-url');
    // The command is still the hosted one and still complete: TLS needs no
    // configuration because the agent carries the certificate for the published
    // loopback name compiled into it.
    expect(cmd).toContain(`--allowed-origins ${page}`);
  });

  it('ignores a loopback origin that is not a URL rather than emitting a broken flag', () => {
    const cmd: string = agentRunCommand({ platform: 'linux-x64', pageOrigin: page, loopbackOrigin: 'not a url' });
    expect(cmd).not.toContain('--loopback');
  });
});
