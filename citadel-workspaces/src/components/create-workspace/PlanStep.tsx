import type { JSX } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  CHAT_DOCUMENT_PACK_ADDON,
  LINK_PACK_ADDON,
  MAX_CHAT_DOCUMENT_PACKS,
  MAX_LINK_PACKS,
  MAX_STORAGE_BLOCKS,
  STORAGE_ADDON,
  addonOfferedOn,
  clampChatDocumentPacks,
  clampLinkPacks,
  clampSeats,
  clampStorageBlocks,
  formatUsd,
  isPaid,
  monthsFreeOnYearly,
  quote,
  tierById,
  type BillingInterval,
  type PlanSelection,
  type Quote,
  type TierId,
} from '@/lib/onboarding/tiers';
import { NumberStepper } from './NumberStepper';
import { PlanCards } from './PlanCards';
import { StepHeading } from './StepHeading';

export interface PlanStepProps {
  readonly plan: PlanSelection;
  readonly onChange: (plan: PlanSelection) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  /** The "Have a code?" field, under the total; the page wires it to the control plane. */
  readonly coupon: JSX.Element;
}

export const INTERVAL_NAME: Readonly<Record<BillingInterval, string>> = { month: 'month', year: 'year' };

function IntervalToggle({ interval, onChange }: { readonly interval: BillingInterval; readonly onChange: (i: BillingInterval) => void }): JSX.Element {
  const saving: number = monthsFreeOnYearly('team');
  const options: ReadonlyArray<readonly [BillingInterval, string]> = [
    ['month', 'Monthly'],
    ['year', `Yearly · ${saving} months free`],
  ];
  return (
    <fieldset className="mb-5 flex justify-center">
      <legend className="sr-only">Billing interval</legend>
      <div className="inline-flex rounded-full border border-border bg-background p-1">
        {options.map(([value, label]) => (
          <label
            key={value}
            data-testid={`interval-${value}`}
            className={cn(
              'cursor-pointer rounded-full px-4 py-2 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-ring',
              interval === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <input
              type="radio"
              name="interval"
              value={value}
              checked={interval === value}
              onChange={() => onChange(value)}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface AddonStepper {
  readonly field: 'storageBlocks' | 'linkPacks' | 'chatDocumentPacks';
  readonly testId: string;
  readonly title: string;
  readonly unitName: string;
  readonly max: number;
  readonly offeredOn: (tier: TierId) => boolean;
  readonly hint: string;
  /** The total's line for `n` units, and what they cost. */
  readonly line: (n: number, q: Quote) => readonly [string, number];
}

/** The add-ons a paid plan may buy, each a stepper beside the seats and a line in the total. */
function addonSteppers(interval: BillingInterval): readonly AddonStepper[] {
  const per: string = INTERVAL_NAME[interval];
  const gb: number = STORAGE_ADDON.gbPerBlock;
  const links: number = LINK_PACK_ADDON.linksPerPack;
  const docs: string = CHAT_DOCUMENT_PACK_ADDON.documentsPerPack.toLocaleString('en-US');
  return [
    {
      field: 'storageBlocks', testId: 'plan-storage', title: 'Extra storage', unitName: `${gb} GB storage blocks`, max: MAX_STORAGE_BLOCKS,
      offeredOn: (tier) => addonOfferedOn(STORAGE_ADDON, tier),
      hint: `${gb} GB blocks, ${formatUsd(STORAGE_ADDON.unitAmount[interval])} each per ${per}.`,
      line: (n, q) => [`${n} × ${gb} GB storage`, q.storageCents],
    },
    {
      field: 'linkPacks', testId: 'plan-link-packs', title: 'Extra secure links', unitName: `${links}-link packs`, max: MAX_LINK_PACKS,
      offeredOn: (tier) => addonOfferedOn(LINK_PACK_ADDON, tier),
      hint: `${links}-link packs, ${formatUsd(LINK_PACK_ADDON.unitAmount[interval])} each per ${per}, shared by the whole workspace.`,
      line: (n, q) => [`${n} × ${links}-link pack`, q.linkPacksCents],
    },
    {
      field: 'chatDocumentPacks', testId: 'plan-chat-document-packs', title: 'Extra chat documents', unitName: `${docs}-document packs`, max: MAX_CHAT_DOCUMENT_PACKS,
      offeredOn: (tier) => addonOfferedOn(CHAT_DOCUMENT_PACK_ADDON, tier),
      hint: `${docs}-document packs, ${formatUsd(CHAT_DOCUMENT_PACK_ADDON.unitAmount[interval])} each per ${per}, for documents shared in chats.`,
      line: (n, q) => [`${n} × ${docs}-document pack`, q.chatDocumentPacksCents],
    },
  ];
}

/** Step 2: which plan, how many seats, how much extra storage and links -- and what that costs. */
export function PlanStep({ plan, onChange, onBack, onContinue, coupon }: PlanStepProps): JSX.Element {
  const paid: boolean = isPaid(plan.tier);
  const q: Quote = quote(plan);
  const per: string = INTERVAL_NAME[plan.interval];
  const addons: readonly AddonStepper[] = addonSteppers(plan.interval).filter((a) => a.offeredOn(plan.tier));

  const selectTier = (tier: TierId): void =>
    onChange({
      ...plan,
      tier,
      seats: isPaid(tier) ? clampSeats(tier, plan.seats) : plan.seats,
      storageBlocks: clampStorageBlocks(tier, plan.storageBlocks),
      linkPacks: clampLinkPacks(tier, plan.linkPacks),
      chatDocumentPacks: clampChatDocumentPacks(tier, plan.chatDocumentPacks),
    });

  return (
    <div>
      <StepHeading title="Choose a plan">Start free, or pay per seat as your team grows.</StepHeading>

      <IntervalToggle interval={plan.interval} onChange={(interval) => onChange({ ...plan, interval })} />
      <PlanCards selected={plan.tier} interval={plan.interval} onSelect={selectTier} />

      {paid && (
        <div className="mt-6 grid gap-4 rounded-xl border border-border bg-background p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="plan-seats" className="block text-sm font-medium text-foreground">Seats</label>
            <NumberStepper
              id="plan-seats"
              label="seats"
              testId="plan-seats"
              value={clampSeats(plan.tier, plan.seats)}
              min={1}
              max={tierById(plan.tier).maxMembers}
              onChange={(seats) => onChange({ ...plan, seats })}
            />
            <p className="text-xs text-muted-foreground">One per member. Up to {tierById(plan.tier).maxMembers.toLocaleString('en-US')}.</p>
          </div>
          {addons.map((a) => (
            <div key={a.field} className="space-y-2">
              <label htmlFor={a.testId} className="block text-sm font-medium text-foreground">{a.title}</label>
              <NumberStepper
                id={a.testId}
                label={a.unitName}
                testId={a.testId}
                value={plan[a.field]}
                min={0}
                max={a.max}
                onChange={(n) => onChange({ ...plan, [a.field]: n })}
              />
              <p className="text-xs text-muted-foreground">{a.hint}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 rounded-xl bg-muted px-4 py-4" data-testid="plan-total" aria-live="polite">
        {paid ? (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-4 text-muted-foreground">
              <dt>{clampSeats(plan.tier, plan.seats)} × {tierById(plan.tier).name} seat</dt>
              <dd className="tabular-nums">{formatUsd(q.seatsCents)}</dd>
            </div>
            {addons.filter((a) => plan[a.field] > 0).map((a) => {
              const [what, cents] = a.line(plan[a.field], q);
              return (
                <div key={a.field} className="flex justify-between gap-4 text-muted-foreground" data-testid={`${a.testId}-line`}>
                  <dt>{what}</dt>
                  <dd className="tabular-nums">{formatUsd(cents)}</dd>
                </div>
              );
            })}
            <div className="flex justify-between gap-4 border-t border-border pt-2 text-base font-semibold text-foreground">
              <dt>Total</dt>
              <dd className="tabular-nums" data-testid="plan-total-amount">{formatUsd(q.totalCents)} / {per}</dd>
            </div>
          </dl>
        ) : (
          <p className="flex justify-between text-base font-semibold text-foreground">
            <span>Total</span>
            <span data-testid="plan-total-amount">Free</span>
          </p>
        )}
        <p className="pt-1 text-xs text-muted-foreground">
          {q.storageGb.toLocaleString('en-US')} GB storage in total. {tierById(plan.tier).secureLinksPerMember} secure links per member
          {q.sharedLinks > 0 && `, plus ${q.sharedLinks.toLocaleString('en-US')} shared`}. {q.chatDocuments.toLocaleString('en-US')} chat documents.
          {paid && ' Paid securely through Stripe Checkout.'}
        </p>
      </div>
      {coupon}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row justify-between">
        <Button type="button" variant="ghost" size="lg" onClick={onBack} className="h-11 gap-2">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <Button type="button" size="lg" onClick={onContinue} data-testid="create-plan-continue" className="h-11 gap-2">
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
