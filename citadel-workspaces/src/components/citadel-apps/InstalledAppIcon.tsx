/**
 * The tree icon of a node that is an installed app's page: the app's own PNG once a listing of it
 * has been read in this tab and it validates (icon.ts), the generic app icon until then. Never the
 * level's icon: the row says it is an app before it knows which one looks like what.
 */
import type { ComponentType } from 'react';
import { Blocks } from 'lucide-react';
import { appIconSrc } from '@/lib/citadel-apps/icon';
import { useAppIcon } from '@/lib/citadel-apps/installed-app-icons';
import type { AppIcon } from 'citadel-workspace-client-ts';

type IconComponent = ComponentType<{ className?: string }>;

const byApp: Map<string, IconComponent> = new Map();

/** One component per app id, so a row keeps the same element type from render to render. */
export function installedAppIcon(appId: string): IconComponent {
  const held: IconComponent | undefined = byApp.get(appId);
  if (held !== undefined) return held;
  function InstalledAppIcon({ className }: { className?: string }): JSX.Element {
    const icon: AppIcon | null = useAppIcon(appId);
    const src: string | null = icon === null ? null : appIconSrc(icon);
    if (src === null) return <Blocks className={className} aria-hidden="true" data-testid="installed-app-icon-generic" />;
    return <img src={src} alt="" aria-hidden="true" className={`rounded-sm object-contain ${className ?? ''}`} data-testid="installed-app-icon" />;
  }
  byApp.set(appId, InstalledAppIcon);
  return InstalledAppIcon;
}
