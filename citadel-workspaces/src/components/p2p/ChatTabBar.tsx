import { useState } from 'react';
import { MessageSquare, FileText, Pencil, X, type LucideIcon } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { RenameDocumentDialog } from './RenameDocumentDialog';

export interface ChatTab {
  id: string;
  type: 'messages' | 'live_document';
  title: string;
  documentId?: string;
  hasUnread?: boolean;  // Notification indicator for unread activity
}

interface ChatTabBarProps {
  tabs: ChatTab[];
  activeTabId: string;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  /** Renames the document behind a tab; rejects with the reason when the title is refused. */
  onTabRename: (documentId: string, title: string) => Promise<void>;
  /** Whether a document's rename is carried: no rename is offered for one that would refuse it. */
  renamable: (documentId: string) => boolean;
}

interface TabProps {
  tab: ChatTab;
  active: boolean;
  onSelect: () => void;
  onClose?: () => void;
  onRename?: () => void;
}

function Tab({ tab, active, onSelect, onClose, onRename }: TabProps): JSX.Element {
  const Icon: LucideIcon = tab.type === 'messages' ? MessageSquare : FileText;
  const showNotificationDot: boolean | undefined = tab.hasUnread && !active;

  const body: JSX.Element = (
    // The tab and its close control are SIBLINGS. A real <button> nested inside
    // a role="button" is the nested-interactive pattern this project's own
    // lib/a11y.ts forbids: assistive technology reports one control where there
    // are two, and the inner one is not reliably reachable.
    <div
      className={`
        group flex items-center
        border-b-2 transition-all duration-150
        ${active
          ? 'border-primary text-foreground bg-background'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/5'
        }
      `}
    >
      <button
        type="button"
        onClick={onSelect}
        // F2 is the rename key in every file manager and tab strip; the context
        // menu is the pointer route and the header pencil the discoverable one.
        onKeyDown={onRename ? (e): void => { if (e.key === 'F2') { e.preventDefault(); onRename(); } } : undefined}
        aria-current={active ? 'page' : undefined}
        data-testid={`chat-tab-${tab.id}`}
        className="flex items-center gap-1.5 px-3 py-2 cursor-pointer bg-transparent text-inherit"
      >
        <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium truncate max-w-[120px]">{tab.title}</span>
        {showNotificationDot && (
          <>
            <span className="notification-dot animate-pulse-green" aria-hidden="true" />
            {/* The dot was the ONLY signal: nothing for a screen reader, and a
                small green-or-nothing cue for a colour-blind user. */}
            <span className="sr-only">, unread activity</span>
          </>
        )}
      </button>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          // Named for THIS tab: "Close tab" repeated down a row of tabs tells a
          // screen-reader user nothing about which one they are on.
          aria-label={`Close ${tab.title}`}
          className={`
            mr-1 p-1.5 rounded-full hover:bg-foreground/10
            ${active ? '' : 'reveal-on-hover'}
          `}
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );

  if (!onRename) return body;
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onRename} data-testid="tab-rename">
          <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
          Rename
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ChatTabBar({ tabs, activeTabId, onTabSelect, onTabClose, onTabRename, renamable }: ChatTabBarProps): JSX.Element {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renaming: ChatTab | undefined = tabs.find((t) => t.id === renamingId);
  return (
    <div className="flex items-center border-b border-surface/50 bg-background overflow-x-auto">
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          onSelect={() => onTabSelect(tab.id)}
          onClose={tab.type === 'live_document' ? (): void => onTabClose(tab.id) : undefined}
          onRename={tab.type === 'live_document' && tab.documentId !== undefined && renamable(tab.documentId) ? (): void => setRenamingId(tab.id) : undefined}
        />
      ))}
      <RenameDocumentDialog
        open={renaming !== undefined}
        currentTitle={renaming?.title ?? ''}
        onRename={(title) => onTabRename(renaming?.documentId ?? '', title)}
        onClose={() => setRenamingId(null)}
      />
    </div>
  );
}

// Default messages tab that should always be present
export const MESSAGES_TAB: ChatTab = {
  id: 'messages',
  type: 'messages',
  title: 'Messages'
};

// Helper to create a live document tab
export function createLiveDocumentTab(documentId: string, title: string): ChatTab {
  return {
    id: `doc-${documentId}`,
    type: 'live_document',
    title,
    documentId
  };
}
