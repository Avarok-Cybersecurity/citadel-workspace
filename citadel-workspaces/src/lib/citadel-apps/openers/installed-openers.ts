/**
 * Installed Citadel Apps as file openers, from their signed manifests: an app whose `opens` names
 * its node tab is offered for those extensions, under its own name and icon, and a file opened in
 * it is handed over (runtime/opened-files.ts) and shown in its tab. An app that opens files only in
 * a page zone is not offered: no surface here can show that zone. One opener per app, whichever of
 * its installs reaches the member first. Pure.
 */
import { createElement, type ComponentType } from 'react';
import type { AppInstall, InstallScope } from 'citadel-workspace-client-ts';
import type { ListedApp } from '../listing-model';
import { appTabKey } from '@/lib/node-tabs/tab-list';
import type { FileOpener } from './openers';

export interface InstalledApp {
  readonly install: AppInstall;
  readonly app: ListedApp;
}

type InstalledOpener = Extract<FileOpener, { kind: 'installed' }>;

const nodeOf = (scope: InstallScope): string | null =>
  typeof scope === 'object' && 'Node' in scope ? scope.Node : typeof scope === 'object' && 'NodeTree' in scope ? scope.NodeTree : null;

function iconOf(pngBase64: string): ComponentType<{ className?: string }> {
  const src: string = `data:image/png;base64,${pngBase64}`;
  return function AppIcon({ className }: { className?: string }): JSX.Element {
    return createElement('img', { src, alt: '', 'aria-hidden': true, className });
  };
}

export function installedOpeners(installed: readonly InstalledApp[]): InstalledOpener[] {
  const seen: Set<string> = new Set();
  return installed.flatMap(({ install, app }: InstalledApp): InstalledOpener[] => {
    const { opens } = app.manifest;
    if (opens === undefined || opens.surface !== 'node_tab' || seen.has(install.app_id)) return [];
    seen.add(install.app_id);
    return [{
      kind: 'installed', id: install.app_id, name: app.manifest.name, icon: iconOf(app.manifest.icon.png_base64),
      firstParty: app.listing.source === 'FirstParty', opens: opens.extensions, maxBytes: opens.max_bytes, where: nodeOf(install.scope),
    }];
  });
}

/** The workspace address of `appId`'s tab on `node` (the node-tab deep link, tab-memory.ts). */
export function appTabPath(node: string, appId: string): string {
  return `/workspace?${new URLSearchParams({ nodeId: node, tab: appTabKey(appId) }).toString()}`;
}
