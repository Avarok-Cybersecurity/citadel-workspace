/**
 * A link that opened the marketplace on one app, when its listing could not be had: no answer, or
 * an unreadable one, is `unreachable` and asked again with one press; a refusal is `unavailable`
 * and goes to an admin. The two used to read the same ("not available to you"), with no step.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { AppListing, AppsRequest } from 'citadel-workspace-client-ts';
import { catalogueText, harness, openModal, viewerHolding, type Harness } from './marketplace-harness';
import { listingOf } from '@/test/app-manifests';
import { readAppsAnswer, type AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import type { AppsModalRequest } from '@/lib/citadel-apps/apps-modal-store';

const NOTES: AppListing = listingOf({ id: 'com.acme.notes', name: 'Notes' }, 'workspace');
const LINK: AppsModalRequest = { kind: 'link', link: { appId: 'com.acme.notes', nodeId: null, version: null, server: null } };
const isGetListing = (r: AppsRequest): boolean => typeof r === 'object' && 'GetListing' in r;

/**
 * The fake kernel holds NOTES but its catalogue lists nothing, so the link asks `GetListing`; the
 * first `failing` of those fail as `first` says, the rest are the fake's own answer.
 */
function withFailingListing(h: Harness, failing: number, first: 'throw' | 'unreadable'): () => number {
  let asked: number = 0;
  const kernel: Harness['kernel'] = h.kernel;
  h.deps.transport = {
    request: async (request: AppsRequest, isOurs: (a: AppsAnswer) => boolean): Promise<AppsAnswer> => {
      if (request === 'ListCatalogue') return readAppsAnswer({ Catalogue: { listings: [] } });
      if (isGetListing(request) && asked++ < failing) {
        if (first === 'throw') throw new Error('the session dropped');
        return readAppsAnswer({ NotAnAnswer: {} });
      }
      return kernel.request(request, isOurs);
    },
  };
  return (): number => asked;
}

describe('a link whose listing could not be had', () => {
  it('with no answer is unreachable, says so, and Try again finds the app', async () => {
    const h: Harness = harness({ visible: [NOTES] }, catalogueText([]));
    const asked: () => number = withFailingListing(h, 1, 'throw');
    openModal(h, viewerHolding(new Set()), LINK);
    const view: HTMLElement = await screen.findByTestId('apps-link-unreachable');
    expect(screen.getByRole('alert').textContent).toBe('The server did not answer. Check your connection and try again.');
    expect(view.textContent).not.toContain('not available');
    expect(screen.queryByTestId('apps-next-ask-admin')).toBeNull();
    fireEvent.click(screen.getByTestId('apps-next-retry'));
    expect((await screen.findByTestId('apps-listing-detail')).textContent).toContain('Notes');
    expect(asked()).toBe(2);
  });

  it('with an answer that does not read is unreachable too', async () => {
    const h: Harness = harness({ visible: [NOTES] }, catalogueText([]));
    withFailingListing(h, 1, 'unreadable');
    openModal(h, viewerHolding(new Set()), LINK);
    await screen.findByTestId('apps-link-unreachable');
    expect(screen.getByRole('alert').textContent).toBe('The server’s answer could not be read. Try again.');
  });

  it('refused is unavailable: an admin request with the link, and every app one press away; control: no retry', async () => {
    const h: Harness = harness({ hidden: [NOTES] }, catalogueText([]));
    openModal(h, viewerHolding(new Set()), LINK);
    await screen.findByTestId('apps-link-unavailable');
    expect(screen.queryByTestId('apps-next-retry')).toBeNull();
    fireEvent.click(screen.getByTestId('apps-next-ask-admin'));
    await screen.findByTestId('apps-next-copied');
    expect(h.copied[0]).toContain('https://work.example/workspace?app=com.acme.notes');
    fireEvent.click(screen.getByTestId('apps-next-apps-browse'));
    await screen.findByTestId('apps-tab-global');
  });
});
