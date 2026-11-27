/**
 * What a report says about where it came from (RECOVERY-DESIGN.md §3.1), gathered from injected
 * reads so the rules are tested without a browser. The tenant is always said (owner decision 1);
 * the person's own handle only when they ask to be contacted (report-model `contact`).
 */
import type { ContextItem } from './report-model';
import { routeTemplate } from './redact';

export interface ContextReads {
  readonly build: string;
  readonly agentVersion: string | null;
  readonly agentOs: string | null;
  readonly userAgent: string;
  readonly viewportWidth: number;
  readonly theme: string;
  readonly pathname: string;
  readonly tenantHost: string | null;
  readonly online: boolean;
}

/** The browser's brand and major version, and the OS family: no build numbers, no plugins. */
export function reducedBrowser(userAgent: string): string {
  const brand: RegExpMatchArray | null =
    userAgent.match(/(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/u);
  const os: string = /Windows/u.test(userAgent) ? 'Windows'
    : /iPhone|iPad/u.test(userAgent) ? 'iOS'
      : /Mac OS X/u.test(userAgent) ? 'macOS'
        : /Android/u.test(userAgent) ? 'Android'
          : /Linux/u.test(userAgent) ? 'Linux' : 'other';
  if (brand === null) return `unknown browser on ${os}`;
  const name: string = brand[1] === 'Version' ? 'Safari' : brand[1] === 'Edg' ? 'Edge' : brand[1] === 'OPR' ? 'Opera' : brand[1];
  return `${name} ${brand[2]} on ${os}`;
}

function viewport(width: number): string {
  return width < 640 ? 'phone' : width < 1024 ? 'tablet' : 'desktop';
}

export function contextItems(reads: ContextReads): ContextItem[] {
  const item = (key: string, label: string, value: string, removable: boolean): ContextItem => ({ key, label, value, removable });
  return [
    item('build', 'App version', reads.build, false),
    item('tenant', 'Workspace server', reads.tenantHost ?? 'none', false),
    item('agent', 'Citadel agent', reads.agentVersion === null ? 'not connected' : `${reads.agentVersion}${reads.agentOs === null ? '' : ` (${reads.agentOs})`}`, true),
    item('browser', 'Browser', reducedBrowser(reads.userAgent), true),
    item('viewport', 'Screen size', viewport(reads.viewportWidth), true),
    item('theme', 'Theme', reads.theme, true),
    item('route', 'Page', routeTemplate(reads.pathname), true),
    item('online', 'Network', reads.online ? 'online' : 'offline', true),
  ];
}
