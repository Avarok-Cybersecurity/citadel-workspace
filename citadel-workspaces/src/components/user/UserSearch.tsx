import React, { useState, useEffect, useRef } from 'react';
import { isMemberOnline } from '@/lib/presence';
import { searchMatcher } from '@/lib/fold-for-search';
import { debugLog } from '@/lib/debug-config';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import type { UserData, UserSearchProps } from './user-search-types';
import { UserSearchResults, RESULTS_LIST_ID } from './UserSearchResults';
import type { User } from '@/types/workspace-entities';

// Re-export types for backward compatibility
export type { UserData } from './user-search-types';

export const UserSearch: React.FC<UserSearchProps> = ({
  onUserSelect,
  enableInvite = false,
  className = '',
  placeholder = 'Search users...',
  exclude = [],
  initialFocus = false
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<UserData[]>([]);
  /**
   * The search itself failed, as distinct from matching nobody.
   *
   * An empty `results` renders "No users found", which is an answer about the
   * workspace. A search that threw left `results` empty too, so the person was
   * told their colleague is not here when the truth is that the question was
   * never answered.
   */
  const [searchFailed, setSearchFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const inputRef: React.RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
  const resultsRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const { state } = useWorkspace();

  // Focus input on mount if initialFocus is true
  useEffect(() => {
    if (initialFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [initialFocus]);

  // Dismiss the results panel: pointer outside it, or Escape.
  //
  // Escape matters because the panel is `position: absolute; z-index: 50` and
  // covers the controls beneath it — on the directory page, the All/Online tabs.
  // A mouse user was already fine (mousedown closes the panel before the click
  // lands), but with no key handler a keyboard user had no way to dismiss it and
  // no way to reach what it covered. That is the combobox behaviour anyone would
  // expect, and its absence was a dead end rather than a cosmetic gap.
  useEffect(() => {
    const dismissOnPointerOutside = (event: MouseEvent): void => {
      if (
        resultsRef.current &&
        !resultsRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowResults(false);
      }
    };

    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Only when open, so Escape stays available to whatever is behind us —
      // a dialog holding this search, for instance.
      setShowResults((open) => {
        if (open) event.stopPropagation();
        return false;
      });
    };

    document.addEventListener('mousedown', dismissOnPointerOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return (): void => {
      document.removeEventListener('mousedown', dismissOnPointerOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, []);

  // Search users
  useEffect(() => {
    const searchUsers = async (): Promise<void> => {
      if (!searchTerm.trim()) {
        setResults([]);
        setSearchFailed(false);
        return;
      }

      setLoading(true);
      setSearchFailed(false);

      try {
        const members: User[] = Object.values(state.members || {});
        // Folded ONCE. `matchesSearch` folds both arguments per call, and this
        // runs over every member on every keystroke -- two normalisations of the
        // same query per member. `exclude` becomes a Set for the same reason:
        // `Array.includes` is a scan per member.
        const matches: (haystack: string) => boolean = searchMatcher(searchTerm);
        const excluded: Set<string> = new Set(exclude);

        const filteredMembers: { id: string; displayName: string; avatarUrl: string | undefined; email: string | undefined; role: string | undefined; roleId: string | undefined; isOnline: boolean | null; lastActive: undefined; }[] = members
          .filter(member =>
            !excluded.has(member.id) &&
            (matches(member.displayName) || (member.email ? matches(member.email) : false))
          )
          .map(member => ({
            id: member.id,
            displayName: member.displayName,
            avatarUrl: member.avatarUrl,
            email: member.email,
            role: member.role,
            roleId: member.roleId,
            // Real presence, from the polled peer registry -- the same set the
            // sidebar's peer list uses. This was `Math.random() > 0.5`, then
            // `connectionService.canMessageUser`, which reads a map written
            // only by the demo simulation and so answered false for everyone.
            isOnline: isMemberOnline(member.id),
            // Deliberately absent: nothing tracks last-seen time yet, and the
            // previous value was a random offset from now. Undefined lets the UI
            // say it does not know instead of stating a time that is made up.
            lastActive: undefined,
          }));

        setResults(filteredMembers);
      } catch (error) {
        debugLog('UserSearch', 'Error searching users:', error);
        setSearchFailed(true);
      } finally {
        setLoading(false);
      }
    };

    const debounceTimeout: NodeJS.Timeout = setTimeout(searchUsers, 300);

    return (): void => {
      clearTimeout(debounceTimeout);
    };
  }, [searchTerm, state.members, exclude]);

  const handleFocus = (): void => {
    setShowResults(true);
  };

  const handleSelectUser = (user: UserData): void => {
    if (onUserSelect) {
      onUserSelect(user);
    }
    setShowResults(false);
    setSearchTerm('');
  };

  const handleClearSearch = (): void => {
    setSearchTerm('');
    inputRef.current?.focus();
  };

  const getRecentUsers = (): UserData[] => {
    const members: User[] = Object.values(state.members || {});

    return members
      .filter(member => !exclude.includes(member.id))
      .slice(0, 5)
      .map(member => ({
        id: member.id,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        email: member.email,
        role: member.role,
        isOnline: isMemberOnline(member.id),
        lastActive: undefined,
      }));
  };

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center bg-card rounded-md border border-border">
        <Search className="h-4 w-4 text-muted-foreground ml-3" />
        <Input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showResults}
          aria-controls={RESULTS_LIST_ID}
          aria-autocomplete="list"
          placeholder={placeholder}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onFocus={handleFocus}
          className="border-0 bg-transparent text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {searchTerm && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 mr-1 text-muted-foreground hover:text-foreground hover:bg-accent"
            onClick={handleClearSearch}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {showResults && (
        <UserSearchResults
          resultsRef={resultsRef}
          searchTerm={searchTerm}
          loading={loading}
          results={results}
          searchFailed={searchFailed}
          recentUsers={searchTerm ? [] : getRecentUsers()}
          enableInvite={enableInvite}
          onSelectUser={handleSelectUser}
        />
      )}
    </div>
  );
};
