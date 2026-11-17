/** The agent's operating system, for people. Its own module: agent-facts is read on the landing page's path, this is not. */
import { agentPlatformCandidates, type AgentPlatform } from '@/lib/agent-download';
import type { AgentFacts } from './agent-facts';

const NAMES: Readonly<Record<string, string>> = { macos: 'macOS', darwin: 'macOS', windows: 'Windows', linux: 'Linux' };

function fromPlatform(platform: AgentPlatform | undefined): string {
  if (platform === undefined) return 'Unknown';
  return platform.startsWith('macos') ? 'macOS' : platform.startsWith('windows') ? 'Windows' : 'Linux';
}

/**
 * The agent's operating system. The agent's own word wins. Without it, this browser's: the
 * agent only talks to a page on its own machine, so they are the same computer.
 */
export function osLabel(facts: AgentFacts, nav: Navigator = navigator): string {
  if (facts.os !== undefined) return NAMES[facts.os.toLowerCase()] ?? facts.os;
  return fromPlatform(agentPlatformCandidates(nav)[0]);
}
