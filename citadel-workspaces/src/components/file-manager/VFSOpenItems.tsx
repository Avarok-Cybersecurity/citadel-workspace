/**
 * A file's open entries in its right-click menu: "Open in <app>" with the app's icon when an app
 * opens it, and an "Open with…" group listing every app when more than one does. The group sits in
 * the menu itself, not a submenu: on a phone a submenu has no room beside its menu and opened off
 * the screen. Nothing when no app opens the file: the menu's Download is then the way on.
 */
import { useId } from 'react';
import { ContextMenuGroup, ContextMenuItem, ContextMenuLabel } from '@/components/ui/context-menu';
import { openLabel, type FileMenuModel, type FileOpener } from '@/lib/citadel-apps/openers/openers';

/** A file menu entry: 44px tall, the touch target the file manager's whole menu keeps. */
export const MENU_ITEM: string = 'min-h-[44px] cursor-pointer';
const ITEM: string = MENU_ITEM;

function AppItem({ app, label, onOpen, testId }: { app: FileOpener; label: string; onOpen: (app: FileOpener) => void; testId: string }): JSX.Element {
  const Icon: FileOpener['icon'] = app.icon;
  return (
    <ContextMenuItem onSelect={() => onOpen(app)} data-testid={testId} data-app={app.id} className={ITEM}>
      <Icon className="mr-2 h-4 w-4" aria-hidden="true" />{label}
    </ContextMenuItem>
  );
}

export function VFSOpenItems({ menu, onOpen }: { menu: FileMenuModel; onOpen: (app: FileOpener) => void }): JSX.Element | null {
  const label: string = useId();
  if (menu.open === null) return null;
  return (
    <>
      <AppItem app={menu.open} label={openLabel(menu.open)} onOpen={onOpen} testId="vfs-open-in-app" />
      {menu.openWith.length > 0 && (
        <ContextMenuGroup aria-labelledby={label} data-testid="vfs-open-with">
          <ContextMenuLabel id={label} className="text-xs font-medium text-muted-foreground">Open with…</ContextMenuLabel>
          {menu.openWith.map((app: FileOpener) => <AppItem key={app.id} app={app} label={app.name} onOpen={onOpen} testId="vfs-open-with-app" />)}
        </ContextMenuGroup>
      )}
    </>
  );
}
