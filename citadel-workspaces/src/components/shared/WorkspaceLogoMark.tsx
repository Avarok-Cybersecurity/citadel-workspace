/**
 * A workspace's logo, drawn as what it is: an uploaded image, an emoji, or initials.
 *
 * One component for every place a workspace is shown. The switcher had two branches -- initials,
 * or `<img src={logo}>` -- so an emoji icon went into `src` and rendered as a broken image.
 */
import type { WorkspaceLogo } from '@/lib/workspace-metadata-service';
import { cn } from '@/lib/utils';

interface WorkspaceLogoMarkProps {
  logo: WorkspaceLogo;
  /** The workspace name: the image's accessible name. */
  name: string;
}

export function WorkspaceLogoMark({ logo, name }: WorkspaceLogoMarkProps): JSX.Element {
  if (logo.type === 'image') {
    return <img src={logo.data} alt={name} data-testid="workspace-logo" className="w-8 h-8 shrink-0 rounded object-cover" />;
  }
  return (
    <div
      data-testid="workspace-logo"
      aria-hidden="true"
      className={cn(
        'w-8 h-8 shrink-0 rounded flex items-center justify-center bg-primary text-primary-foreground font-semibold',
        logo.type === 'emoji' ? 'text-lg' : 'text-sm',
      )}
    >
      {logo.data}
    </div>
  );
}
