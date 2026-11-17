/**
 * The share dialog in its widest states: choosing who and how long, the link shown once, and a
 * booking page's guests with a count the server refuses (the longest copy that field says).
 */
import { ShareLinkDialogView } from '@/components/share/ShareLinkDialogView';
import { SecureLinkPanel } from '@/components/share/SecureLinkPanel';
import { draftOf } from '@/lib/share/grant-draft';
import { shareTarget } from '@/lib/share/share-target';

const NOOP = () => {};
const TARGET = shareTarget(
  { kind: 'group-chat', groupId: 'g-1', name: 'Quarterly planning — design, engineering and operations', members: ['alice', 'bob', 'carol', 'dave'] },
  { cid: 1n, username: 'alice' },
);
const DRAFT = { ...draftOf(TARGET.defaultGrant), members: ['bartholomew.longname', 'carol'], roles: ['member'], workspace: true };

const BOOKING = shareTarget({ kind: 'booking-page', nodeId: 'n-1', host: 'bartholomew.longname', nodeName: 'Platform engineering and operations' }, null);
const GUESTS = { ...draftOf(BOOKING.defaultGrant), booking: { ...BOOKING.booking, maxGuests: 51 } };

const flowIn = (phase, draft = DRAFT) => ({
  draft, setDraft: NOOP, preset: '7d', setPreset: NOOP, oneTime: draft.booking === null, setOneTime: NOOP, oneTimeAllowed: draft.booking === null,
  quota: { kind: 'known', quota: { live: 12, perMember: 50, pool: 100, poolUsed: 30 } }, phase, create: async () => {},
});

function ShareDialog({ phase, target = TARGET, draft = DRAFT }) {
  return (
    <ShareLinkDialogView open onClose={NOOP} targets={[target]} plainLinks={[]} plainNote="" mode="secure" onMode={NOOP} secureUnavailable={null}
      secure={<SecureLinkPanel flow={flowIn(phase, draft)} target={target} members={['bob', 'dave']} roles={[{ id: 'member', name: 'Member' }]} isAdmin onManageLinks={NOOP} />} />
  );
}

export const SHARE_SCENARIOS = {
  'share-secure-editing': () => <ShareDialog phase={{ kind: 'editing' }} />,
  'share-booking-guests': () => <ShareDialog phase={{ kind: 'editing' }} target={BOOKING} draft={GUESTS} />,
  'share-secure-created': () => <ShareDialog phase={{ kind: 'created', url: `${location.origin}/?redirect=${'x'.repeat(43)}&server=work.example.com` }} />,
};
