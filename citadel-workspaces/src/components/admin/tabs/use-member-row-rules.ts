/** The members tab's per-row rules, bound to this workspace's ladder. Wiring only; see member-row-rules. */
import { useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useRoleLadder, type RoleLadder } from '@/hooks/use-role-ladder';
import { memberRowRules } from './member-row-rules';
import type { MemberRowRules } from './MemberRow';
import type { MemberData } from '../types';

export type MemberRules = (member: MemberData) => MemberRowRules;

export function useMemberRowRules(): MemberRules {
  const ladder: RoleLadder = useRoleLadder(true);
  const { state } = useWorkspace();
  const self: string | undefined = state.currentUser?.username;
  return useCallback(
    (member: MemberData): MemberRowRules => memberRowRules(ladder, member, member.userId === self || member.username === self),
    [ladder, self],
  );
}
