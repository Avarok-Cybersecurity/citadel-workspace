/**
 * One app, from its listing to installed: detail, scope, consent, the server's work, the answer.
 * The steps are install-flow.ts's; this draws each and sends the install. Reached from a node's
 * "+" (`forTab`), the scope starts at "this page and the pages below it" when this person may
 * choose it, and the installed app is then added as the node's tab.
 */
import { useReducer, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AppInstall, InstallScope } from 'citadel-workspace-client-ts';
import type { ListedApp } from '@/lib/citadel-apps/listing-model';
import { flowReducer, START, type FlowState } from '@/lib/citadel-apps/install-flow';
import { installScopeOf, scopeDomain, scopeOptions, type ScopeChoice, type ScopeContext, type ScopeOption } from '@/lib/citadel-apps/scope-options';
import { consentRows, grantOf, grantProblem, keyTrust, type ConsentRow } from '@/lib/citadel-apps/consent-model';
import { scopeSentence } from '@/lib/citadel-apps/scope-sentence';
import { refusalCopy } from '@/lib/citadel-apps/refusal-copy';
import { installApp, type AppsResult } from '@/lib/workspace-service/apps-operations';
import { listingOffer } from '@/lib/citadel-apps/listing-offer';
import { ListingDetail } from './ListingDetail';
import { ScopePicker } from './ScopePicker';
import { ConsentPanel } from './ConsentPanel';
import type { MarketplaceDeps, MarketplaceViewer } from './marketplace-types';

interface AppFlowProps {
  app: ListedApp;
  installs: readonly AppInstall[];
  deps: MarketplaceDeps;
  viewer: MarketplaceViewer;
  onInstalled: (install: AppInstall) => void;
  onDone: () => void;
  /** Adding a tab to `viewer.nodeId`: the install is then appended to its tabs; null otherwise. */
  forTab: { add: (appId: string) => Promise<boolean> } | null;
}

/** The scope a tab's install starts at: the page and below, when this person may choose it. */
export function preferredTabScope(options: readonly ScopeOption[]): ScopeChoice | null {
  return options.some((o: ScopeOption): boolean => o.choice === 'node_tree' && o.enabled) ? 'node_tree' : null;
}

export function AppFlow({ app, installs, deps, viewer, onInstalled, onDone, forTab }: AppFlowProps): JSX.Element {
  const [state, dispatch] = useReducer(flowReducer, START);
  const [tabAdded, setTabAdded] = useState<boolean | null>(null);
  const m: ListedApp['manifest'] = app.manifest;
  const mine: AppInstall[] = installs.filter((i: AppInstall) => i.app_id === m.id);
  const sentence = (scope: InstallScope): string => scopeSentence(scope, viewer.reach(scope), viewer.nodeName);

  const install = async (scope: InstallScope, rows: readonly ConsentRow[]): Promise<void> => {
    dispatch({ kind: 'install' });
    const result: AppsResult<AppInstall> = await installApp(deps.transport, {
      appId: m.id, version: m.version, listing: listingOffer(app.listing), scope, granted: grantOf(rows), pinnedPublisherKey: m.publisher.mldsa65_public_key, injectRequirement: false,
    });
    if (result.ok) {
      onInstalled(result.value);
      if (forTab !== null) setTabAdded(await forTab.add(m.id));
      dispatch({ kind: 'installed', install: result.value });
    } else {
      dispatch({ kind: 'refused', refusal: result.refusal });
    }
  };

  const s: FlowState = state;
  const ctx: ScopeContext = { scopes: m.scopes, audience: m.audience, nodeId: viewer.nodeId, rootId: viewer.rootId, authority: viewer.authority };
  const chooseScope = (): void => {
    dispatch({ kind: 'choose-scope' });
    const preferred: ScopeChoice | null = forTab === null ? null : preferredTabScope(scopeOptions(ctx));
    if (preferred !== null) dispatch({ kind: 'select', choice: preferred, people: [] });
  };
  if (s.step === 'detail') return <ListingDetail app={app} installs={mine} onInstall={chooseScope} />;

  if (s.step === 'scope') {
    const go = (): void => {
      if (s.choice === null) return;
      const scope: InstallScope | null = installScopeOf(s.choice, viewer.me, viewer.nodeId, s.people);
      if (scope !== null) dispatch({ kind: 'consent', scope });
    };
    return (
      <ScopePicker
        options={scopeOptions(ctx)}
        nodeName={viewer.nodeId === null ? null : viewer.nodeName(viewer.nodeId)}
        members={viewer.members.filter((name: string) => name !== viewer.me)}
        selection={{ choice: s.choice, people: s.people }}
        onSelect={(next) => dispatch({ kind: 'select', choice: next.choice, people: next.people })}
        onContinue={go}
        onBack={() => dispatch({ kind: 'back' })}
      />
    );
  }

  if (s.step === 'consent') {
    const rows: ConsentRow[] = consentRows(m, new Set(s.turnedOff), viewer.authority, scopeDomain(s.scope, viewer.rootId));
    return (
      <ConsentPanel
        app={app}
        scopeSentence={sentence(s.scope)}
        rows={rows}
        onToggle={(cap, on) => dispatch({ kind: 'toggle', cap, on })}
        trust={keyTrust(m.publisher.mldsa65_public_key, installs, m.id)}
        problem={grantProblem(rows)}
        onInstall={() => { void install(s.scope, rows); }}
        onBack={() => dispatch({ kind: 'back' })}
        clock={deps.clock}
      />
    );
  }

  if (s.step === 'installing') {
    return (
      <div role="status" className="flex flex-col gap-[8px] py-[32px]" data-testid="apps-install-progress">
        <p className="font-medium text-foreground">Installing {m.name}…</p>
        <p className="text-sm text-muted-foreground">The workspace server is fetching the app and checking its signature and hash.</p>
      </div>
    );
  }

  if (s.step === 'done') {
    return (
      <div role="status" className="flex flex-col gap-[12px] py-[12px]" data-testid="apps-install-done">
        <p className="font-medium text-foreground">{m.name} {s.install.version} is installed.</p>
        <p className="text-sm text-muted-foreground">For: {sentence(s.install.scope)}</p>
        {tabAdded !== null && (
          <p className="text-sm text-foreground" data-testid="apps-install-tab">
            {tabAdded ? 'It is now a tab on this page.' : 'It was not added as a tab; you can add it with “+”.'}
          </p>
        )}
        <Button className="min-h-[44px] self-start" onClick={onDone}>Done</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[12px] py-[12px]" data-testid="apps-install-failed">
      <p role="alert" className="break-words text-foreground">{m.name} was not installed. {refusalCopy(s.refusal)}</p>
      <Button variant="outline" className="min-h-[44px] self-start" onClick={() => dispatch({ kind: 'back' })}>Back</Button>
    </div>
  );
}
