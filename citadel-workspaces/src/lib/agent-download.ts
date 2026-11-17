/**
 * Where to send someone whose browser cannot reach the local agent.
 *
 * The agent is a separate binary the user runs on their own machine; the web
 * app is useless without one. Telling them "unable to reach the connection
 * service" and stopping there is only half an answer if they have never
 * installed it.
 *
 * The asset names below are a CONTRACT with .github/workflows/release-agent.yml.
 * Nothing at runtime would notice them drifting apart — a renamed asset simply
 * yields a 404 the moment a user clicks, which is the worst place to discover
 * it. `agent-download.test.ts` reads the workflow and fails if the two lists
 * stop matching.
 */

/** Stable platform tokens, matching the release workflow's matrix. */
export type AgentPlatform = 'macos-arm64' | 'macos-x64' | 'linux-x64' | 'windows-x64';

export const AGENT_ASSETS: Record<AgentPlatform, string> = {
  'macos-arm64': 'citadel-agent-macos-arm64.tar.gz',
  'macos-x64': 'citadel-agent-macos-x64.tar.gz',
  'linux-x64': 'citadel-agent-linux-x64.tar.gz',
  'windows-x64': 'citadel-agent-windows-x64.zip',
};

/**
 * The Mac download: one universal app (Apple Silicon and Intel) in a notarised, stapled disk
 * image, built by release-agent.yml's macos-app job. It runs the agent with the right settings
 * itself, so a Mac visitor downloads, drags it into Applications and opens it: no archive, no
 * command, and no processor to pick. Same contract as AGENT_ASSETS: the test reads the workflow.
 */
export const MAC_APP_ASSET: 'Citadel-Agent.dmg' = 'Citadel-Agent.dmg';

/** Windows: an installer that registers the agent to start now and at login. */
export const WINDOWS_INSTALLER_ASSET: 'Citadel-Agent-x64.msi' = 'Citadel-Agent-x64.msi';

/** Ubuntu and Debian: a package that installs the agent and starts it at login. */
export const LINUX_DEB_ASSET: 'citadel-agent-linux-x64.deb' = 'citadel-agent-linux-x64.deb';

/** Every other Linux distribution: one self-contained executable. */
export const LINUX_APPIMAGE_ASSET: 'Citadel-Agent-x86_64.AppImage' = 'Citadel-Agent-x86_64.AppImage';

/** The operating systems that get a one-click installer. */
export type InstallerFamily = 'mac' | 'windows' | 'linux';

/** The one-click downloads for each family, most widely applicable first. */
export const INSTALLER_ASSETS: Readonly<Record<InstallerFamily, readonly string[]>> = {
  mac: [MAC_APP_ASSET],
  windows: [WINDOWS_INSTALLER_ASSET],
  linux: [LINUX_DEB_ASSET, LINUX_APPIMAGE_ASSET],
};

/** The repository whose release workflow builds, publishes and attests every asset above. */
export const RELEASE_REPO: 'Avarok-Cybersecurity/citadel-workspace' = 'Avarok-Cybersecurity/citadel-workspace';

export const RELEASES_PAGE: string = `https://github.com/${RELEASE_REPO}/releases/latest`;

/**
 * Which agent builds could run on this visitor's machine.
 *
 * Returns a LIST, not a best guess. macOS is the reason: Safari and Chrome both
 * report "MacIntel" for `navigator.platform` on Apple Silicon, and the reliable
 * discriminator (`userAgentData.getHighEntropyValues`) is async and absent in
 * Safari. Guessing hands an Intel archive to an ARM Mac, which fails only after
 * the download completes and looks like a broken release. Offering both costs
 * the user one decision and cannot be wrong.
 *
 * An empty list means no agent build fits — phones and tablets, which report
 * Linux or Mac but cannot run it. The UI shows the releases page instead of a
 * download that would not work.
 */
export function agentPlatformCandidates(nav: Navigator = navigator): AgentPlatform[] {
  const uaData: { platform?: string; } | undefined = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform: string = (uaData?.platform ?? nav.platform ?? '').toLowerCase();
  const ua: string = (nav.userAgent ?? '').toLowerCase();

  if (platform.includes('win') || ua.includes('windows')) return ['windows-x64'];

  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('android')) return [];

  if (platform.includes('linux') || ua.includes('linux')) return ['linux-x64'];

  if (platform.includes('mac') || ua.includes('mac os')) {
    // iPadOS masquerades as a Mac; touch points give it away.
    if ((nav.maxTouchPoints ?? 0) > 2) return [];
    return ['macos-arm64', 'macos-x64'];
  }

  return [];
}

/** Download URL for any published asset, resolved by GitHub to the newest release. */
export function releaseAssetUrl(asset: string): string {
  return `https://github.com/${RELEASE_REPO}/releases/latest/download/${asset}`;
}

/** Download URL for a platform's raw archive. */
export function agentDownloadUrl(platform: AgentPlatform): string {
  return releaseAssetUrl(AGENT_ASSETS[platform]);
}

/** Which one-click installer fits these candidates; undefined when none does (phones, unknown). */
export function installerFamily(candidates: readonly AgentPlatform[]): InstallerFamily | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.every((c) => c === 'macos-arm64' || c === 'macos-x64')) return 'mac';
  if (candidates.every((c) => c === 'windows-x64')) return 'windows';
  if (candidates.every((c) => c === 'linux-x64')) return 'linux';
  return undefined;
}

/**
 * The three STUN servers the agent requires (--stun-servers; it will not start without them),
 * the same list the Mac app's Info.plist passes: Cloudflare's, and two of Google's, since the
 * agent classifies its NAT by comparing three independent answers.
 */
export const AGENT_STUN_SERVERS: string =
  'stun.cloudflare.com:3478,stun1.l.google.com:19302,stun4.l.google.com:19302';

/** What the hosted page knows that the command needs. */
export interface RunCommandInputs {
  platform: AgentPlatform;
  /** The page's own origin: the one page this agent should let drive it. */
  pageOrigin: string;
  /** The published loopback origin (`wss://local.example.com:12345`), or none. */
  loopbackOrigin: string | undefined;
}

/**
 * The exact command to start the agent for THIS page.
 *
 * Two things a visitor could not have guessed: the binary in the archive is `citadel-agent`
 * (the release workflow names it so; a test here checks that against the workflow), and the
 * agent refuses to start without `--allowed-origins`. Both are derivable from the page, so
 * the page says them. A copy button that yields something unrunnable is worse than none: it
 * looks like the instruction, so the reader stops looking for the real one -- which is what
 * this function did for every hosted visitor until the two invented `--loopback-*` flags
 * below were removed.
 *
 * Every flag emitted here is checked against the agent's own CLI by
 * scripts/check-the-run-command-uses-real-flags.mjs.
 */
export function agentRunCommand({ platform, pageOrigin, loopbackOrigin }: RunCommandInputs): string {
  const binary: string = platform === 'windows-x64' ? '.\\citadel-agent.exe' : './citadel-agent';
  const parts: string[] = [
    binary,
    '--bind 127.0.0.1:12345',
    '--backend filesystem',
    `--allowed-origins ${pageOrigin}`,
    `--stun-servers ${AGENT_STUN_SERVERS}`,
  ];
  // NO loopback flags. This used to append `--loopback-host` and
  // `--loopback-cert-url`, and the agent has never had either:
  //
  //   error: Found argument '--loopback-host' which wasn't expected
  //
  // Its whole CLI is --bind, --backend, --data-dir, --allowed-origins,
  // --tls-cert, --tls-key, --no-tls and --dangerous. Worse, the two were
  // appended only when `loopbackOrigin` is set -- which is exactly the hosted
  // deployment, and nowhere else. So the one place this command matters, every
  // visitor was handed something the agent refuses to start with, and the
  // comment above this function names that failure precisely: a copy button
  // that yields something unrunnable is worse than none, because it looks like
  // the instruction and the reader stops looking for the real one.
  //
  // Nothing is needed in their place. The agent serves TLS by default and
  // carries the certificate for the published loopback name compiled into it
  // (see BUILTIN_TLS_CERT), so a visitor configures nothing. An operator
  // publishing a DIFFERENT loopback name supplies --tls-cert/--tls-key when
  // they start their own agent; that is an operator's decision and not
  // something this page can know or should guess.
  //
  // `loopbackOrigin` is still taken, and still meaningful: it is what tells the
  // page it is hosted rather than local. It simply does not change the command.
  void loopbackOrigin;
  return parts.join(' ');
}
