import type { JSX } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TIERS,
  LINK_PACK_ADDON,
  STORAGE_ADDON,
  addonOfferedOn,
  formatUsd,
  type BillingInterval,
  type Tier,
  type TierId,
} from '@/lib/onboarding/tiers';

export interface PlanCardsProps {
  readonly selected: TierId;
  readonly interval: BillingInterval;
  readonly onSelect: (tier: TierId) => void;
}

const INTERVAL_SHORT: Readonly<Record<BillingInterval, string>> = { month: 'mo', year: 'yr' };

function features(tier: Tier): string[] {
  const storage: string =
    tier.storage.kind === 'total' ? `${tier.storage.gb} GB storage` : `${tier.storage.gb} GB storage per seat`;
  const list: string[] = [
    tier.workspaces === 1 ? '1 workspace' : `${tier.workspaces} workspaces`,
    `Up to ${tier.maxMembers.toLocaleString('en-US')} members`,
    storage,
    `${tier.secureLinksPerMember} secure links per member`,
    'Post-quantum end-to-end encryption',
  ];
  if (tier.unitAmount) list.push(`Extra storage in ${STORAGE_ADDON.gbPerBlock} GB blocks`);
  if (addonOfferedOn(LINK_PACK_ADDON, tier.id)) list.push(`Extra secure links in ${LINK_PACK_ADDON.linksPerPack}-link packs`);
  if (tier.prioritySupport) list.push('Priority support');
  return list;
}

/**
 * The three plans, as a radio group.
 *
 * Real radio inputs, visually hidden inside each card's label: arrow keys move
 * between plans, the group has one tab stop, and a screen reader announces
 * "Team, radio button, 2 of 3, checked" -- none of which a row of styled divs
 * provides without re-implementing it.
 */
export function PlanCards({ selected, interval, onSelect }: PlanCardsProps): JSX.Element {
  return (
    <fieldset>
      <legend className="sr-only">Plan</legend>
      <div className="grid gap-3 md:grid-cols-3">
        {TIERS.map((tier) => {
          const checked: boolean = tier.id === selected;
          const price: string = tier.unitAmount ? formatUsd(tier.unitAmount[interval]) : '$0';
          return (
            <label
              key={tier.id}
              data-testid={`plan-${tier.id}`}
              className={cn(
                'relative flex cursor-pointer flex-col rounded-xl border bg-background p-4 transition-colors focus-within:ring-2 focus-within:ring-ring',
                checked ? 'border-primary-accent ring-1 ring-primary-accent' : 'border-border hover:border-primary-accent/50',
              )}
            >
              <input
                type="radio"
                name="plan"
                value={tier.id}
                checked={checked}
                onChange={() => onSelect(tier.id)}
                className="sr-only"
              />
              <span className="flex items-center justify-between">
                <span className="text-base font-semibold text-foreground">{tier.name}</span>
                {tier.prioritySupport && (
                  <span className="rounded-full bg-primary-accent/15 px-2 py-0.5 text-xs font-medium text-foreground">
                    Priority
                  </span>
                )}
              </span>
              <span className="mt-3 flex items-baseline gap-1">
                <span className="text-2xl font-bold tracking-tight text-foreground">{price}</span>
                <span className="text-sm text-muted-foreground">
                  {tier.unitAmount ? `/ seat / ${INTERVAL_SHORT[interval]}` : 'forever'}
                </span>
              </span>
              <span className="mt-2 text-sm text-muted-foreground">{tier.summary}</span>
              <ul className="mt-4 space-y-2 text-sm text-foreground">
                {features(tier).map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary-accent" aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
