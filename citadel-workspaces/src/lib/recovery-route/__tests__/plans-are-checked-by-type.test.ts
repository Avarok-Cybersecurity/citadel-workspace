/**
 * The rules the types carry (RECOVERY-DESIGN.md §2.1). Each `@ts-expect-error` is a plan the
 * compiler must refuse; were the rule lost, the directive itself would fail `npm run typecheck`.
 */
import { describe, expect, it } from 'vitest';
import type { BindingOf } from '../binding';
import type { DeclaredPlan, RecoveryPlan } from '../route';
import { recovery } from '../recovery';
import { appsFailureTag } from '../surfaces/apps';
import { SURFACES } from '../surfaces';

describe('plans the compiler refuses', () => {
  it('a plan has no default route', () => {
    // @ts-expect-error a plan without a primary route
    const none: RecoveryPlan = { cause: 'ours', presentation: 'toast', alternatives: [] };
    expect('primary' in none).toBe(false);
  });

  it('a wait always says what follows it', () => {
    // @ts-expect-error a wait without `then`
    const endless: RecoveryPlan = { cause: 'peer', presentation: 'banner', primary: { kind: 'wait', until: 'peer-online', deadlineMs: 1 }, alternatives: [] };
    expect('then' in endless.primary).toBe(false);
  });

  it('a wait does not fall back to another wait', () => {
    const nested: RecoveryPlan = {
      cause: 'peer', presentation: 'banner', alternatives: [],
      // @ts-expect-error a wait whose fallback is a wait
      primary: { kind: 'wait', until: 'peer-online', deadlineMs: 1, then: { kind: 'wait', until: 'peer-online', deadlineMs: 1, then: { kind: 'retry' } } },
    };
    expect(nested.primary.kind === 'wait' ? nested.primary.then.kind : null).toBe('wait');
  });

  it('a page or a modal offers more than an acknowledgement', () => {
    // @ts-expect-error a blocking surface whose only way out is "OK"
    const blocked: DeclaredPlan = { cause: 'ours', presentation: 'page', primary: { kind: 'acknowledge', why: 'informational' }, alternatives: [] };
    expect(blocked.primary.kind).toBe('acknowledge');
  });

  it('a wait cannot be rendered without the signal that ends it', () => {
    // @ts-expect-error the topic owner's wait needs `wake`
    const binding: BindingOf<(typeof SURFACES)['topic.owner-offline']> = { retry: async (): Promise<void> => undefined };
    expect('wake' in binding).toBe(false);
  });

  it('an ask cannot be sent without saying what it is about', () => {
    // @ts-expect-error apps.Unavailable asks the admins, so it needs `askAbout`
    expect(recovery('apps.Unavailable', {})).toBeDefined();
  });
});

describe('the apps registry', () => {
  it('names an object refusal by its one variant', () => {
    expect(appsFailureTag({ PermissionRequired: 'EditWorkspaceConfig' } as never)).toBe('PermissionRequired');
    expect(appsFailureTag('NoAnswer')).toBe('NoAnswer');
  });
});
