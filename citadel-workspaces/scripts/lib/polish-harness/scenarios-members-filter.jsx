/**
 * The Members tab's filter over a list with a booking guest whose handle is one long token: the
 * real filter and rows, at the admin panel's width. A scenario supplies input; it replaces nothing.
 */
import { useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MembersFilter } from '@/components/admin/tabs/MembersFilter';
import { MemberRow } from '@/components/admin/tabs/MemberRow';
import { membersShown } from '@/components/admin/tabs/members-filter';

const NOOP = () => {};
const RULES = { roles: [], assignable: new Set(), isOnlyManager: false, actOnBlocked: null };
const MEMBERS = [
  { userId: 'ada', username: 'ada', name: 'Ada Lovelace', roleId: 'member', isGuest: false },
  { userId: 'gus', username: 'bartholomew.longname.booking-guest-from-outside', roleId: 'nothing', isGuest: true },
];

function MembersWithFilter({ initial }) {
  const [filter, setFilter] = useState(initial);
  return (
    <TooltipProvider>
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4" data-testid="members-filter-frame">
        <MembersFilter members={MEMBERS} value={filter} onChange={setFilter} />
        <div className="space-y-2" id="members-tab-list">
          {membersShown(MEMBERS, filter).map((m) => (
            <MemberRow key={m.userId} member={m} showAdvanced={false} isUpdatingRole={false} rules={RULES}
              onRoleChange={NOOP} onAdvancedPermissions={NOOP} onRemove={NOOP} />
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

export const MEMBERS_FILTER_SCENARIOS = {
  'members-filter-everyone': () => <MembersWithFilter initial="everyone" />,
  'members-filter-guests': () => <MembersWithFilter initial="guests" />,
};
