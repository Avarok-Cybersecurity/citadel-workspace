/**
 * A chat file's menu, behind a "more" button that is always shown (a touch screen has no hover
 * and no right-click): "Open in <app>" with the app's icon when an app opens the file, "Open
 * with…" listing them when several do (a group in the menu, not a submenu, which has no room beside
 * the menu on a phone), and Download. The bubble's right-click opens the same menu.
 */
import { useId } from 'react';
import { Download, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { openLabel, type FileOpener } from '@/lib/citadel-apps/openers/openers';
import type { ChatFileOpening } from './use-chat-file-opening';

const ITEM: string = 'min-h-[44px] cursor-pointer';

function AppItem({ app, label, onOpen, testId }: { app: FileOpener; label: string; onOpen: (app: FileOpener) => void; testId: string }): JSX.Element {
  const Icon: FileOpener['icon'] = app.icon;
  return (
    <DropdownMenuItem onSelect={() => onOpen(app)} data-testid={testId} data-app={app.id} className={ITEM}>
      <Icon className="mr-2 h-4 w-4" aria-hidden="true" />{label}
    </DropdownMenuItem>
  );
}

export function ChatFileMenu({ name, opening, download }: { name: string; opening: ChatFileOpening; download: (() => void) | null }): JSX.Element | null {
  const { menu, openIn, menuOpen, setMenuOpen } = opening;
  const label: string = useId();
  if (menu.open === null && !menu.download) return null;
  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${name}`}
          data-testid="chat-file-menu"
          onClick={(e) => e.stopPropagation()}
          className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal aria-hidden="true" className="h-[18px] w-[18px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[224px]" collisionPadding={8}>
        {menu.open !== null && <AppItem app={menu.open} label={openLabel(menu.open)} onOpen={openIn} testId="chat-file-open-in-app" />}
        {menu.openWith.length > 0 && (
          <DropdownMenuGroup aria-labelledby={label} data-testid="chat-file-open-with">
            <DropdownMenuLabel id={label} className="text-xs font-medium text-muted-foreground">Open with…</DropdownMenuLabel>
            {menu.openWith.map((app: FileOpener) => <AppItem key={app.id} app={app} label={app.name} onOpen={openIn} testId="chat-file-open-with-app" />)}
          </DropdownMenuGroup>
        )}
        {menu.download && (
          <DropdownMenuItem onSelect={() => download?.()} data-testid="chat-file-download" className={ITEM}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />Download
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
