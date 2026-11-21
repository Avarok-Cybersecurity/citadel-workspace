/**
 * Every banned account, with Unban: a member removed after the ban is on no roster, so without
 * this list the ban could not be found or lifted. Asked of the server (`ListBanned`) for whoever
 * holds RemoveUsers, as lifting a ban needs, and asked again whenever a member write lands.
 */
import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import WorkspaceService from '@/lib/workspace-service';
import { eventEmitter } from '@/lib/event-emitter';
import { workspaceEvents } from '@/lib/workspace-events';
import { debugLog } from '@/lib/debug-config';
import type { WorkspaceMember } from '@/types/workspace-entities';
import type { MemberData } from '../types';
import { asMemberData } from './member-data';

interface BannedSectionProps {
  /** The reader holds RemoveUsers at the workspace. */
  allowed: boolean;
  onUnban: (member: MemberData) => void;
}

const REASK_AFTER: readonly string[] = ['members:reload', 'member:role-updated'];

export function BannedSection({ allowed, onUnban }: BannedSectionProps): JSX.Element | null {
  const [banned, setBanned] = useState<MemberData[] | null>(null);

  useEffect(() => {
    if (!allowed) return undefined;
    const ask = (): void => {
      WorkspaceService.listBanned().catch((error: unknown): void => debugLog('BannedSection', 'Failed to request banned members:', error));
    };
    const stop: () => void = workspaceEvents.onMemberEvent('members:banned-loaded', ({ members }: { members: WorkspaceMember[] }): void => {
      setBanned(members.map((m: WorkspaceMember): MemberData => asMemberData(m, { accessViaName: undefined, isGuest: false })));
    });
    const stops: (() => void)[] = REASK_AFTER.map((event: string): (() => void) => eventEmitter.on(event, ask));
    ask();
    return (): void => { stop(); stops.forEach((s: () => void): void => s()); };
  }, [allowed]);

  if (!allowed || banned === null) return null;
  return (
    <section className="space-y-2" aria-labelledby="banned-heading" data-testid="banned-section">
      <h3 id="banned-heading" className="text-sm font-medium text-foreground">Banned</h3>
      {banned.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one is banned</p>
      ) : (
        <ul className="space-y-2">
          {banned.map((member: MemberData) => (
            <li key={member.userId} className="flex items-center justify-between gap-3 p-3 bg-background rounded-lg" data-testid={`banned-${member.userId}`}>
              <span className="min-w-0 truncate text-foreground">{member.name || member.username}</span>
              <Button variant="outline" size="sm" onClick={(): void => onUnban(member)} data-testid={`banned-unban-${member.userId}`}>
                <Undo2 className="h-4 w-4 mr-1" aria-hidden="true" />
                Unban<span className="sr-only"> {member.username}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
