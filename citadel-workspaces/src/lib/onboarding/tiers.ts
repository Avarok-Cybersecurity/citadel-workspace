/**
 * The plans a new workspace can be created on, and what a selection costs.
 *
 * A MIRROR, not the source. The one source is the parent repository's
 * `billing/tiers.json`: scripts/stripe-catalogue.mjs makes Stripe match it and
 * the tenant control plane reads its limits. The UI cannot import that file (it
 * lives outside this repository), so the numbers are copied here once and
 * `__tests__/tiers-match-the-catalogue.test.ts` reads the JSON and fails when
 * the two disagree. Amounts are in cents, per seat, exactly as the catalogue
 * states them, so the comparison is value for value with no conversion to hide
 * a mistake in.
 *
 * What the page shows is a QUOTE. Stripe Checkout computes the real charge from
 * the catalogue's prices; if this mirror drifted, the visitor would be shown one
 * number and billed another, which is why the drift test exists.
 */

export type TierId = 'free' | 'team' | 'business';
export type BillingInterval = 'month' | 'year';
export type PaidTierId = Exclude<TierId, 'free'>;

export type TierStorage =
  | { readonly kind: 'total'; readonly gb: number }
  | { readonly kind: 'per-seat'; readonly gb: number };

export interface Tier {
  readonly id: TierId;
  /** The short name the page uses; the catalogue's is "Citadel Workspace <name>". */
  readonly name: string;
  readonly summary: string;
  readonly workspaces: number;
  readonly maxMembers: number;
  readonly storage: TierStorage;
  readonly prioritySupport: boolean;
  /** Live secure links each member may hold; packs add a pool the workspace shares. */
  readonly secureLinksPerMember: number;
  /** Documents shared in chats the whole workspace may hold, every node's together; packs add more. */
  readonly chatDocuments: number;
  /** Cents per seat for each interval, or `null` for the free tier. */
  readonly unitAmount: Readonly<Record<BillingInterval, number>> | null;
}

export const TIERS: readonly Tier[] = [
  {
    id: 'free',
    name: 'Free',
    summary: 'For a small team trying Citadel out.',
    workspaces: 1,
    maxMembers: 5,
    storage: { kind: 'total', gb: 1 },
    prioritySupport: false,
    secureLinksPerMember: 5,
    chatDocuments: 50,
    unitAmount: null,
  },
  {
    id: 'team',
    name: 'Team',
    summary: 'For teams that work in Citadel every day.',
    workspaces: 1,
    maxMembers: 100,
    storage: { kind: 'per-seat', gb: 10 },
    prioritySupport: false,
    secureLinksPerMember: 50,
    chatDocuments: 1000,
    unitAmount: { month: 600, year: 6000 },
  },
  {
    id: 'business',
    name: 'Business',
    summary: 'For organisations with room to grow.',
    workspaces: 1,
    maxMembers: 1000,
    storage: { kind: 'per-seat', gb: 25 },
    prioritySupport: true,
    secureLinksPerMember: 50,
    chatDocuments: 10000,
    unitAmount: { month: 1200, year: 12000 },
  },
];

export interface StorageAddon {
  readonly gbPerBlock: number;
  readonly availableOn: readonly PaidTierId[];
  readonly unitAmount: Readonly<Record<BillingInterval, number>>;
}

/** The extra-storage add-on: bought in 10 GB blocks, on paid tiers only. */
export const STORAGE_ADDON: StorageAddon = {
  gbPerBlock: 10,
  availableOn: ['team', 'business'],
  unitAmount: { month: 200, year: 2000 },
};

/**
 * The most blocks the stepper offers. A UI bound only: the catalogue sets no
 * ceiling, and a workspace needing more than a terabyte extra is a
 * conversation rather than a stepper.
 */
export const MAX_STORAGE_BLOCKS: number = 100;

export interface LinkPackAddon {
  readonly linksPerPack: number;
  readonly availableOn: readonly PaidTierId[];
  readonly unitAmount: Readonly<Record<BillingInterval, number>>;
}

/** Secure-link packs: 50 links each, into one pool the whole workspace shares; paid tiers only. */
export const LINK_PACK_ADDON: LinkPackAddon = {
  linksPerPack: 50,
  availableOn: ['team', 'business'],
  unitAmount: { month: 200, year: 2000 },
};

/** The most packs the stepper offers. A UI bound only, like MAX_STORAGE_BLOCKS. */
export const MAX_LINK_PACKS: number = 100;

export interface ChatDocumentPackAddon {
  readonly documentsPerPack: number;
  readonly availableOn: readonly PaidTierId[];
  readonly unitAmount: Readonly<Record<BillingInterval, number>>;
}

/** Chat-document packs: 5000 more documents shared in chats each; Business only. */
export const CHAT_DOCUMENT_PACK_ADDON: ChatDocumentPackAddon = {
  documentsPerPack: 5000,
  availableOn: ['business'],
  unitAmount: { month: 500, year: 5000 },
};

/** The most packs the stepper offers. A UI bound only, like MAX_STORAGE_BLOCKS. */
export const MAX_CHAT_DOCUMENT_PACKS: number = 100;

export interface PlanSelection {
  readonly tier: TierId;
  readonly interval: BillingInterval;
  readonly seats: number;
  readonly storageBlocks: number;
  readonly linkPacks: number;
  readonly chatDocumentPacks: number;
}

export function tierById(id: TierId): Tier {
  const tier: Tier | undefined = TIERS.find((t) => t.id === id);
  if (!tier) throw new Error(`Unknown tier: ${id}`);
  return tier;
}

export function isPaid(id: TierId): id is PaidTierId {
  return tierById(id).unitAmount !== null;
}

/** Whether an add-on (`STORAGE_ADDON`, `LINK_PACK_ADDON`, `CHAT_DOCUMENT_PACK_ADDON`) is sold on `id`. */
export function addonOfferedOn(addon: { readonly availableOn: readonly PaidTierId[] }, id: TierId): boolean {
  return isPaid(id) && addon.availableOn.includes(id);
}

/** Clamp a seat count into what the tier allows. Free has exactly one "seat": the workspace. */
export function clampSeats(id: TierId, seats: number): number {
  if (!isPaid(id)) return 1;
  const whole: number = Number.isFinite(seats) ? Math.round(seats) : 1;
  return Math.min(Math.max(whole, 1), tierById(id).maxMembers);
}

/** An add-on quantity a tier can actually buy: none where it is not sold, otherwise whole units up to `max`. */
function clampUnits(addon: { readonly availableOn: readonly PaidTierId[] }, id: TierId, units: number, max: number): number {
  if (!addonOfferedOn(addon, id)) return 0;
  const whole: number = Number.isFinite(units) ? Math.round(units) : 0;
  return Math.min(Math.max(whole, 0), max);
}

export function clampStorageBlocks(id: TierId, blocks: number): number {
  return clampUnits(STORAGE_ADDON, id, blocks, MAX_STORAGE_BLOCKS);
}

export function clampLinkPacks(id: TierId, packs: number): number {
  return clampUnits(LINK_PACK_ADDON, id, packs, MAX_LINK_PACKS);
}

export function clampChatDocumentPacks(id: TierId, packs: number): number {
  return clampUnits(CHAT_DOCUMENT_PACK_ADDON, id, packs, MAX_CHAT_DOCUMENT_PACKS);
}

export interface Quote {
  readonly seatsCents: number;
  readonly storageCents: number;
  readonly linkPacksCents: number;
  readonly chatDocumentPacksCents: number;
  readonly totalCents: number;
  readonly storageGb: number;
  /** Links the packs add to the workspace's shared pool, beyond each member's own allowance. */
  readonly sharedLinks: number;
  /** Documents shared in chats the workspace may hold: the tier's, plus what the packs add. */
  readonly chatDocuments: number;
}

/**
 * What a selection costs per interval, in cents.
 *
 * Seats, storage blocks and packs are clamped first, so the quote is always for a
 * selection that could actually be bought.
 */
export function quote(selection: PlanSelection): Quote {
  const tier: Tier = tierById(selection.tier);
  const seats: number = clampSeats(tier.id, selection.seats);
  const blocks: number = clampStorageBlocks(tier.id, selection.storageBlocks);
  const perSeat: number = tier.unitAmount ? tier.unitAmount[selection.interval] : 0;
  const seatsCents: number = perSeat * seats;
  const storageCents: number = blocks * STORAGE_ADDON.unitAmount[selection.interval];
  const packs: number = clampLinkPacks(tier.id, selection.linkPacks);
  const linkPacksCents: number = packs * LINK_PACK_ADDON.unitAmount[selection.interval];
  const documentPacks: number = clampChatDocumentPacks(tier.id, selection.chatDocumentPacks);
  const chatDocumentPacksCents: number = documentPacks * CHAT_DOCUMENT_PACK_ADDON.unitAmount[selection.interval];
  const baseGb: number = tier.storage.kind === 'total' ? tier.storage.gb : tier.storage.gb * seats;
  return {
    seatsCents,
    storageCents,
    linkPacksCents,
    chatDocumentPacksCents,
    totalCents: seatsCents + storageCents + linkPacksCents + chatDocumentPacksCents,
    storageGb: baseGb + blocks * STORAGE_ADDON.gbPerBlock,
    sharedLinks: packs * LINK_PACK_ADDON.linksPerPack,
    chatDocuments: tier.chatDocuments + documentPacks * CHAT_DOCUMENT_PACK_ADDON.documentsPerPack,
  };
}

/** `$6`, `$6.50`, `$1,200` -- whole dollars lose their cents, as a price list does. */
export function formatUsd(cents: number): string {
  const whole: boolean = cents % 100 === 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/** How many months a yearly price gives away against twelve monthly ones. */
export function monthsFreeOnYearly(id: PaidTierId): number {
  const amounts: Readonly<Record<BillingInterval, number>> | null = tierById(id).unitAmount;
  if (!amounts) return 0;
  return Math.round((amounts.month * 12 - amounts.year) / amounts.month);
}
