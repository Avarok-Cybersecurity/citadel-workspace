import React from 'react';
import {
  agentPlatformCandidates,
  agentRunCommand,
  installerFamily,
  type AgentPlatform,
} from '@/lib/agent-download';
import { AGENT_SETUP_COPY } from '@/lib/agent-setup-copy';
import { readLoopbackAgentOrigin } from '@/lib/websocket-service/resolve-url';
import { OneClickInstall } from './OneClickInstall';
import { AgentSetupAdvanced } from './AgentSetupAdvanced';
import { useLoopbackAccess } from '@/hooks/use-loopback-access';
import type { LoopbackAccess } from '@/lib/loopback-permission';

/**
 * - `compact`: inside a dialog that has already said the agent cannot be reached; leads with
 *   the question, so the panel reads as the answer to it.
 * - `full`: a page step whose own heading already says "download the agent"; no question.
 */
export type AgentSetupLayout = 'compact' | 'full';

export interface AgentSetupProps {
  layout: AgentSetupLayout;
  /** The navigator to read the platform from. Tests pass one; the app passes `navigator`. */
  navigatorRef: Navigator;
}

/**
 * The one place the app tells a visitor how to install the agent.
 *
 * Every screen that needs the agent renders this rather than its own instructions: the
 * visitor's one-click installer first, then the same collapsed Advanced section everywhere.
 * All of its words live in `agent-setup-copy.ts`.
 */
export const AgentSetup: React.FC<AgentSetupProps> = ({ layout, navigatorRef }) => {
  const candidates: AgentPlatform[] = agentPlatformCandidates(navigatorRef);
  // Derived from the page, so the command is right for THIS deployment: the origin that may
  // drive the agent. See agentRunCommand. Linux's form when the device has no build: it is
  // the one shown beside the archives someone on another machine would fetch.
  const runCommand: string = agentRunCommand({
    platform: candidates[0] ?? 'linux-x64',
    pageOrigin: window.location.origin,
    loopbackOrigin: readLoopbackAgentOrigin(document),
  });

  // Before the install steps: when the browser is what blocks the page, reinstalling fixes
  // nothing. Granting reloads, since a connection stuck on the prompt never recovers.
  const loopback: LoopbackAccess = useLoopbackAccess(navigatorRef.permissions, () => window.location.reload());
  const blockedBy: { heading: string; body: string } | null =
    loopback === 'denied'
      ? { heading: AGENT_SETUP_COPY.loopback.deniedHeading, body: AGENT_SETUP_COPY.loopback.deniedBody }
      : loopback === 'prompt'
        ? { heading: AGENT_SETUP_COPY.loopback.promptHeading, body: AGENT_SETUP_COPY.loopback.promptBody }
        : null;

  return (
    <div
      className={`min-w-0 text-sm ${layout === 'compact' ? 'rounded-md border border-border bg-muted/40 p-3' : ''}`}
      data-testid="agent-setup"
      data-layout={layout}
    >
      {blockedBy && (
        <div className="mb-3 rounded-md border border-warning/50 bg-warning/10 p-3" role="note" data-testid="agent-setup-loopback" data-state={loopback}>
          <p className="text-foreground font-medium">{blockedBy.heading}</p>
          <p className="mt-1 text-muted-foreground">{blockedBy.body}</p>
        </div>
      )}
      {layout === 'compact' && <p className="text-foreground font-medium">{AGENT_SETUP_COPY.question}</p>}
      <p className={`text-muted-foreground ${layout === 'compact' ? 'mt-1' : ''}`}>{AGENT_SETUP_COPY.intro}</p>
      <OneClickInstall family={installerFamily(candidates)} />
      <AgentSetupAdvanced runCommand={runCommand} />
    </div>
  );
};
