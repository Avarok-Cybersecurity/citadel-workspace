/**
 * Settings -> Sign-in keys, backed by the server through SignInManagement.
 *
 * The server holds the account's factors and verifies every request; this only
 * asks. Every request -- listing included -- needs a fresh step-up (the
 * password, or a key touch), collected by `requestStepUp` at that moment and
 * never kept. So the section opens on "Show my sign-in keys", and each change
 * then applies its own outcome rather than re-listing (lib/sign-in/listing.ts).
 * A refusal is shown in the server's own words.
 */
import { useEffect, useState } from 'react';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import type { TabIdentity } from '@/lib/tab-identity';
import { passkeysAvailableHere } from '@/lib/passkey';
import { stringToBytes } from '@/lib/utils/encoding-utils';
import {
  addSecurityKey, browserSignInDeps, manageSignIn, saveHint, tenantOf, type SignInDeps,
} from '@/lib/sign-in';
import { keyFailureCopy } from '@/lib/sign-in/copy';
import type { AddedKey } from '@/lib/sign-in/enrol-key';
import {
  type Listing, listingOf, withKeyAdded, withKeyRemoved, withKeyRenamed, withNewPhrase, withPolicy,
} from '@/lib/sign-in/listing';
import { isPhraseUnchecked, recordPhraseCheck } from '@/lib/recovery/phrase-unchecked';
import { errorLog } from '@/lib/debug-config';
import type { AccountRef, SignInManagementOp, SignInManagementOutcome, SignInPolicy, StepUp } from '@/lib/sign-in/types';

export interface SignInKeys {
  available: boolean;
  account: AccountRef | null;
  /** Null until the user has stepped up and the server has listed the factors. */
  listing: Listing | null;
  busy: boolean;
  message: string | null;
  /** A new recovery phrase, to show once and then forget. */
  freshPhrase: readonly string[] | null;
  /** This account's phrase was shown but its check skipped; only a new phrase fixes that. */
  phraseUnchecked: boolean;
  /** The fresh phrase's step is finished (checked or skipped): forget the words, remember which. */
  finishPhrase: (checked: boolean) => Promise<void>;
  show: () => Promise<void>;
  add: (label: string) => Promise<boolean>;
  rename: (id: number, label: string) => Promise<boolean>;
  remove: (id: number) => Promise<void>;
  setPolicy: (policy: SignInPolicy) => Promise<void>;
  regeneratePhrase: () => Promise<void>;
}

/** Collects the step-up for one request: the typed password, null to use a key, or cancelled. */
export type StepUpRequest = () => Promise<string | null | 'cancelled'>;

type Run<T> = (deps: SignInDeps, stepUp: StepUp) => Promise<T>;

export function useSignInKeys(requestStepUp: StepUpRequest): SignInKeys {
  const available: boolean = passkeysAvailableHere();
  const me: TabIdentity | null = useTabIdentity();
  const account: AccountRef | null = me?.username && me.cid !== undefined && me.serverAddress
    ? { tenant: tenantOf(me.serverAddress), cid: me.cid, username: me.username } : null;
  const [listing, setListing] = useState<Listing | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const [freshPhrase, setFreshPhrase] = useState<readonly string[] | null>(null);
  const [phraseUnchecked, setPhraseUnchecked] = useState<boolean>(false);
  // The account object is rebuilt each render; its tenant and CID are what name it.
  const tenant: string | null = account?.tenant ?? null;
  const cid: bigint | null = account?.cid ?? null;
  useEffect((): (() => void) | undefined => {
    if (tenant === null || cid === null) return undefined;
    let live: boolean = true;
    isPhraseUnchecked({ tenant, cid }).then(
      (unchecked: boolean): void => { if (live) setPhraseUnchecked(unchecked); },
      (error: unknown): void => errorLog('Recovery', 'Could not read whether the phrase was checked', error));
    return (): void => { live = false; };
  }, [tenant, cid]);

  /** One request: step up, ask the server. Resolves with its result, or null if it did not happen. */
  const request = async <T>(run: Run<T>, done: string): Promise<T | null> => {
    if (!account) return null;
    const typed: string | null | 'cancelled' = await requestStepUp();
    if (typed === 'cancelled') return null;
    setBusy(true);
    setMessage(null);
    try {
      const result: T = await run(browserSignInDeps(), { password: typed === null ? null : stringToBytes(typed), security_key: available });
      setMessage(done);
      return result;
    } catch (error) {
      setMessage(keyFailureCopy(error));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const op = (o: SignInManagementOp): Run<SignInManagementOutcome> => (deps: SignInDeps, stepUp: StepUp): Promise<SignInManagementOutcome> =>
    manageSignIn(deps.send, account?.cid ?? 0n, o, stepUp);
  /** Apply a change's effect to what is on screen. */
  const apply = (next: (l: Listing) => Listing): void => setListing((l: Listing | null) => (l ? next(l) : l));

  return {
    available, account, listing, busy, message, freshPhrase, phraseUnchecked,
    finishPhrase: async (checked: boolean): Promise<void> => {
      setFreshPhrase(null);
      if (!account) return;
      await recordPhraseCheck(account, checked)
        .then((): void => setPhraseUnchecked(!checked))
        .catch((error: unknown): void => setMessage(`This device could not remember whether the phrase was checked: ${keyFailureCopy(error)}`));
    },
    show: async (): Promise<void> => {
      const outcome: SignInManagementOutcome | null = await request(op('ListCredentials'), '');
      if (outcome !== null) setListing(listingOf(outcome));
    },
    add: async (label: string): Promise<boolean> => {
      if (!account) return false;
      const added: AddedKey | null = await request(
        (deps: SignInDeps, stepUp: StepUp): Promise<AddedKey> => addSecurityKey(deps, { account, label }, stepUp),
        `${label} can now sign in to ${account.username}.`);
      if (added) apply((l: Listing) => withKeyAdded(l, added, label, Date.now()));
      return added !== null;
    },
    rename: async (id: number, label: string): Promise<boolean> => {
      const renamed: boolean = (await request(op({ RenameCredential: { id, label } }), 'Renamed.')) !== null;
      if (renamed) apply((l: Listing) => withKeyRenamed(l, id, label));
      return renamed;
    },
    remove: async (id: number): Promise<void> => {
      if ((await request(op({ RemoveCredential: { id } }), 'Removed.')) !== null) apply((l: Listing) => withKeyRemoved(l, id));
    },
    setPolicy: async (next: SignInPolicy): Promise<void> => {
      if (!account || (await request(op({ SetSignInPolicy: { policy: next } }), 'Saved.')) === null) return;
      apply((l: Listing) => withPolicy(l, next));
      await saveHint(browserSignInDeps().store, { ...account, keyFirst: next === 'KeyOnly' })
        .catch((error: unknown): void => setMessage(`Saved, but this device could not remember it: ${keyFailureCopy(error)}`));
    },
    regeneratePhrase: async (): Promise<void> => {
      const outcome: SignInManagementOutcome | null = await request(op('RegenerateRecoveryPhrase'), '');
      if (outcome !== null && typeof outcome === 'object' && 'RecoveryPhrase' in outcome) {
        setFreshPhrase(outcome.RecoveryPhrase);
        apply(withNewPhrase);
      }
    },
  };
}
