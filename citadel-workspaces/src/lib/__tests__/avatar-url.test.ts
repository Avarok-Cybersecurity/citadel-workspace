/**
 * One reader for the three shapes `metadata.avatar` arrives in.
 *
 * Before this module there were two, and they disagreed: the profile-update
 * handler accepted a bare string, `{ content }` and `{ String }`, while the
 * settings tab accepted only `{ content }`. A wire format understood in two
 * places drifts, and the copy that drifts is the one nobody is watching.
 */
import { describe, it, expect } from 'vitest';
import { avatarUrlFromMetadata } from '../avatar-url';

const B64: string = 'UklGRhoAAABXRUJQ';

describe('reading an avatar out of user metadata', () => {
  it('accepts the tagged-enum shape the server actually sends', () => {
    // MetadataValue::String(..) serialises as { type: "String", content: "..." }.
    expect(avatarUrlFromMetadata({ avatar: { type: 'String', content: B64 } }))
      .toBe(`data:image/webp;base64,${B64}`);
  });

  it('accepts the two legacy shapes rather than dropping the photo', () => {
    expect(avatarUrlFromMetadata({ avatar: B64 })).toBe(`data:image/webp;base64,${B64}`);
    expect(avatarUrlFromMetadata({ avatar: { String: B64 } })).toBe(`data:image/webp;base64,${B64}`);
  });

  it('does not prefix something that is already a data URL', () => {
    const url: string = `data:image/png;base64,${B64}`;
    expect(avatarUrlFromMetadata({ avatar: url })).toBe(url);
  });

  it('returns undefined rather than a broken src when there is no avatar', () => {
    // The discrimination control: a reader that returned a prefix for anything
    // would put `data:image/webp;base64,` into an <img src> and render a broken
    // image where the initials fallback belongs.
    expect(avatarUrlFromMetadata(undefined)).toBeUndefined();
    expect(avatarUrlFromMetadata(null)).toBeUndefined();
    expect(avatarUrlFromMetadata({})).toBeUndefined();
    expect(avatarUrlFromMetadata({ avatar: {} })).toBeUndefined();
    expect(avatarUrlFromMetadata({ avatar: '' })).toBeUndefined();
    expect(avatarUrlFromMetadata({ avatar: { content: 42 } })).toBeUndefined();
  });
});
