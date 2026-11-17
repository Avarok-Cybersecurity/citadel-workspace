/**
 * One secure link in Security settings: what it is and who it opens for, how long it has left,
 * how often it was used; then Extend, Regenerate and Delete. The token is never here.
 */
import { RefreshCw, Trash2 } from 'lucide-react';
import type { SecureLinkInfo } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format-time';
import { describeGrants } from '@/lib/share/grant-draft';
import { expiresInText, type LifetimePreset } from '@/lib/share/link-lifetime';
import { kindOfTarget, SHARE_KIND_NAMES, type ShareKind } from '@/lib/share/target-rules';
import { LifetimeSelect } from './LifetimeSelect';

export function usesText(link: Pick<SecureLinkInfo, 'uses' | 'last_used_ms'>): string {
  const uses: string = link.uses === 0 ? 'Not used yet' : `Used ${link.uses} time${link.uses === 1 ? '' : 's'}`;
  return link.last_used_ms === null ? uses : `${uses} · last ${formatDateTime(link.last_used_ms)}`;
}

export function SecureLinkRow({ link, nowMs, roleName, busy, onExtend, onRegenerate, onDelete }: {
  link: SecureLinkInfo;
  nowMs: number;
  roleName: (id: string) => string;
  busy: boolean;
  onExtend: (preset: LifetimePreset) => void;
  onRegenerate: () => void;
  onDelete: () => void;
}): JSX.Element {
  const kind: ShareKind | null = kindOfTarget(link.target);
  const label: string = link.label.trim() === '' ? 'Untitled link' : link.label;
  const expires: string = expiresInText(link.expires_ms, nowMs);
  return (
    <li className="space-y-2 rounded-lg bg-background/50 p-3" data-testid="secure-link-row">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          <span className="text-foreground/80">{kind === null ? 'Link' : SHARE_KIND_NAMES[kind]}</span>
          {' · '}{describeGrants(link.grants, roleName)}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="secure-link-expiry">
          {link.one_time ? `One-time · ${expires}` : expires} · {usesText(link)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <LifetimeSelect id={`extend-${link.id}`} label={`Extend ${label}`} value={null} onChange={onExtend} disabled={busy} testId="secure-link-extend" />
        <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5" disabled={busy} onClick={onRegenerate}
          aria-label={`Regenerate ${label}`} data-testid="secure-link-regenerate">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />Regenerate
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5 text-destructive-emphasis" disabled={busy} onClick={onDelete}
          aria-label={`Delete ${label}`} data-testid="secure-link-delete">
          <Trash2 className="h-4 w-4" aria-hidden="true" />Delete
        </Button>
      </div>
    </li>
  );
}
