/** An app's icon: its PNG when it validates (lib/citadel-apps/icon.ts), the generic icon otherwise. */
import { Blocks } from 'lucide-react';
import type { AppIcon } from 'citadel-workspace-client-ts';
import { appIconSrc } from '@/lib/citadel-apps/icon';

interface AppIconImageProps {
  /** Null draws the generic icon: an app the viewer may not see shows no icon of its own. */
  icon: AppIcon | null;
  size: number;
}

export function AppIconImage({ icon, size }: AppIconImageProps): JSX.Element {
  const src: string | null = icon === null ? null : appIconSrc(icon);
  const box: React.CSSProperties = { width: `${size}px`, height: `${size}px` };
  if (src === null) {
    return (
      <span aria-hidden="true" data-testid="app-icon-generic" className="flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" style={box}>
        <Blocks style={{ width: `${size * 0.55}px`, height: `${size * 0.55}px` }} />
      </span>
    );
  }
  return <img src={src} alt="" aria-hidden="true" data-testid="app-icon-image" className="shrink-0 rounded-lg object-contain" style={box} />;
}
