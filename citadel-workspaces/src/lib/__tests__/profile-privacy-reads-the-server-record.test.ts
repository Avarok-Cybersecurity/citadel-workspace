/**
 * The privacy choices stored on the server's user record, as the client
 * reads them back.
 *
 * `MetadataValue` is `#[serde(tag = "type", content = "content")]`, so a flag
 * arrives as `{ type: "Boolean", content: false }`. Reading it as text (the
 * only reader there was) answers undefined for every flag, which for profile
 * visibility would show "visible" to someone who had hidden it.
 *
 * The keys and the unset default mirror the kernel; see
 * citadel-workspace-server-kernel/tests/profile_privacy_mirror.rs.
 */
import { describe, it, expect } from 'vitest';
import {
  metadataFlag,
  showsProfileToStrangers,
  publishedAcceptsStrangers,
  publishedShowsOnlineStatus,
  PRIVACY_METADATA_KEYS,
  SHOW_PROFILE_TO_STRANGERS_WHEN_UNSET,
} from '../profile-privacy';

const flag = (content: boolean): { type: string; content: boolean } => ({ type: 'Boolean', content });

describe('metadataFlag', () => {
  it('reads the tagged wire shape', () => {
    expect(metadataFlag({ k: flag(false) }, 'k')).toBe(false);
    expect(metadataFlag({ k: flag(true) }, 'k')).toBe(true);
  });

  it('is undefined for an absent key or a value that is not a flag', () => {
    expect(metadataFlag({}, 'k')).toBeUndefined();
    expect(metadataFlag({ k: { type: 'String', content: 'false' } }, 'k')).toBeUndefined();
    expect(metadataFlag(undefined, 'k')).toBeUndefined();
  });
});

describe('the stored choices', () => {
  it('reads a hidden profile as hidden', () => {
    expect(showsProfileToStrangers({ [PRIVACY_METADATA_KEYS.showProfileToStrangers]: flag(false) })).toBe(false);
  });

  it('reads an unset choice as the server does', () => {
    expect(showsProfileToStrangers({})).toBe(SHOW_PROFILE_TO_STRANGERS_WHEN_UNSET);
  });

  it('reports a published request policy, and nothing when none is published', () => {
    expect(publishedAcceptsStrangers({ [PRIVACY_METADATA_KEYS.acceptsRequestsFromStrangers]: flag(false) })).toBe(false);
    expect(publishedAcceptsStrangers({})).toBeUndefined();
  });

  it('reports a published Online Status choice, and nothing when none is published', () => {
    expect(publishedShowsOnlineStatus({ shows_online_status: flag(false) })).toBe(false);
    expect(publishedShowsOnlineStatus({})).toBeUndefined();
  });
});
