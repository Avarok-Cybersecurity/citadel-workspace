import { SidebarMenuItem } from '@/components/ui/sidebar';

/**
 * What the member list says when an admin has switched "Members can see each
 * other" off for this node or a level above it.
 *
 * Not the empty state: "Nobody else is here yet" would be a claim about who is
 * here, made about a list this user is not allowed to see.
 */
export function MembersHiddenNotice({ domainId }: { domainId: string }): JSX.Element {
  return (
    <SidebarMenuItem
      className="px-3 py-2 text-sm text-muted-foreground"
      data-testid="members-hidden"
      data-domain-id={domainId}
    >
      An admin has chosen not to show who else is here. You can still use this space as usual.
    </SidebarMenuItem>
  );
}
