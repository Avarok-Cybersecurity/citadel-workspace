/**
 * A report as it opens in the dialog: everything held, the context read now. The reads are this
 * page's real ones; the rules they feed are pure (context.ts, report-model.ts).
 */
import { agentFacts, type AgentFacts } from '@/lib/agent-update/agent-facts';
import { connectionManager } from '@/lib/connection';
import type { CurrentConnectionInfo } from '@/lib/connection/types';
import { trailSnapshot } from '@/lib/recovery-route/trail';
import { crumbsSnapshot } from './breadcrumbs';
import { contextItems } from './context';
import { consoleRingSnapshot } from './ring';
import { REPORT_FORMAT, fitted, type BugReport, type ContextItem } from './report-model';

function tenantHostOf(info: CurrentConnectionInfo | null): string | null {
  const address: string | undefined = info?.serverAddress;
  if (address === undefined || address.trim() === '') return null;
  // An address is a host, maybe with a port; anything after a slash is not ours to send.
  return address.replace(/^[a-z]+:\/\//iu, '').split('/')[0] ?? null;
}

export function gatherReport(surface: string): BugReport {
  const facts: AgentFacts = agentFacts.get();
  const info: CurrentConnectionInfo | null = connectionManager.getConnectionInfo();
  const context: ContextItem[] = contextItems({
    build: `seq ${__BUILD_SEQ__}`,
    agentVersion: facts.version ?? null,
    agentOs: facts.os ?? null,
    userAgent: navigator.userAgent,
    viewportWidth: window.innerWidth,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    pathname: window.location.pathname,
    tenantHost: tenantHostOf(info),
    online: navigator.onLine,
  });
  return fitted({
    format: REPORT_FORMAT,
    surface,
    note: '',
    contact: null,
    context,
    console: consoleRingSnapshot(),
    crumbs: crumbsSnapshot(),
    trail: trailSnapshot(),
  });
}

/** `handle@host` for "Avarok may contact me", or null when this tab is not signed in. */
export function contactHandle(): string | null {
  const info: CurrentConnectionInfo | null = connectionManager.getConnectionInfo();
  const host: string | null = tenantHostOf(info);
  if (info?.username === undefined || host === null) return null;
  return info.username.includes('@') ? info.username : `${info.username}@${host}`;
}
