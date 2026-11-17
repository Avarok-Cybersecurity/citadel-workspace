/**
 * One app's listing: what it is, who publishes it, the version listed and the one you have, and
 * what it asks for, then the way to install it. The description is plain text with line breaks;
 * nothing in a listing is rendered as markdown or markup.
 */
import { Button } from '@/components/ui/button';
import type { AppInstall } from 'citadel-workspace-client-ts';
import type { ListedApp } from '@/lib/citadel-apps/listing-model';
import { CAPABILITY_COPY } from '@/lib/citadel-apps/capability-copy';
import { AppIconImage } from './AppIconImage';

interface ListingDetailProps {
  app: ListedApp;
  installs: readonly AppInstall[];
  onInstall: () => void;
}

export function installedVersionCopy(installs: readonly AppInstall[], listed: string): string | null {
  if (installs.length === 0) return null;
  const versions: string[] = [...new Set(installs.map((i: AppInstall) => i.version))];
  const update: boolean = versions.some((v: string) => v !== listed);
  return `Installed: ${versions.join(', ')}${update ? ` · ${listed} is listed` : ''}`;
}

export function ListingDetail({ app, installs, onInstall }: ListingDetailProps): JSX.Element {
  const m: ListedApp['manifest'] = app.manifest;
  const installedCopy: string | null = installedVersionCopy(installs, m.version);
  return (
    <section className="flex flex-col gap-[16px]" data-testid="apps-listing-detail" aria-labelledby="apps-detail-name">
      <header className="flex items-start gap-[12px]">
        <AppIconImage icon={m.icon} size={56} />
        <div className="flex min-w-0 flex-col gap-[2px]">
          <h3 id="apps-detail-name" className="break-words text-lg font-semibold text-foreground">{m.name}</h3>
          <p className="text-sm text-muted-foreground">Version {m.version} · {app.origin === 'global' ? 'Global catalogue' : 'This workspace'}</p>
          <p className="break-words text-sm text-muted-foreground">Published by {m.publisher.name}</p>
          {installedCopy !== null && <p className="text-sm text-foreground" data-testid="apps-detail-installed">{installedCopy}</p>}
        </div>
      </header>
      <p className="break-words text-foreground/80">{m.summary}</p>
      <p className="whitespace-pre-wrap break-words text-sm text-foreground/80" data-testid="apps-detail-description">{m.description}</p>
      <div>
        <h4 className="mb-[4px] text-sm font-medium text-foreground">It asks to</h4>
        <ul className="flex list-disc flex-col gap-[4px] pl-[20px] text-sm text-foreground/80">
          {m.capabilities.map((c: ListedApp['manifest']['capabilities'][number]) => (
            <li key={c.cap} className="break-words">{CAPABILITY_COPY[c.cap].label}{c.optional ? ' (you can turn this off)' : ''}</li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">Categories: {m.categories.join(', ')}</p>
      <Button className="min-h-[44px] self-start" onClick={onInstall} data-testid="apps-detail-install">Choose where to install</Button>
    </section>
  );
}
