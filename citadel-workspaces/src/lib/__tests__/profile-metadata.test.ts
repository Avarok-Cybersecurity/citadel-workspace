/**
 * Email and job title ride in `User.metadata` in the same three shapes the
 * avatar does, and must reach the member list (and the signed-in user's own
 * state) through the one reader that knows them.
 */
import { describe, it, expect } from 'vitest';
import { metadataText, profileFieldsFromMetadata } from '../profile-metadata';
import { mapWasmMember } from '../workspace-response-handler/member-mapping';
import { currentUserProfileFromMetadata } from '../current-user-profile';

describe('reading profile text out of metadata', () => {
  it('reads every shape the server has sent', () => {
    expect(metadataText({ email: { type: 'String', content: 'a@b' } }, 'email')).toBe('a@b');
    expect(metadataText({ email: 'a@b' }, 'email')).toBe('a@b');
    expect(metadataText({ email: { String: 'a@b' } }, 'email')).toBe('a@b');
  });

  it('returns undefined for absent, empty or non-string values', () => {
    expect(metadataText(undefined, 'email')).toBeUndefined();
    expect(metadataText(null, 'email')).toBeUndefined();
    expect(metadataText({}, 'email')).toBeUndefined();
    expect(metadataText({ email: '' }, 'email')).toBeUndefined();
    expect(metadataText({ email: { content: 42 } }, 'email')).toBeUndefined();
    expect(metadataText({ email: null }, 'email')).toBeUndefined();
  });

  it('reads the right key for each field', () => {
    expect(profileFieldsFromMetadata({
      email: { type: 'String', content: 'a@b' },
      title: { type: 'String', content: 'Engineer' },
    })).toEqual({ email: 'a@b', title: 'Engineer' });
  });
});

describe('where they surface', () => {
  it('a member record carries them, and the avatar, to the member list', () => {
    const member: ReturnType<typeof mapWasmMember> = mapWasmMember({
      id: 'alice', name: 'Alice', role: 'Member',
      metadata: {
        avatar: { type: 'String', content: 'UklGR' },
        email: { type: 'String', content: 'a@b' },
        title: { type: 'String', content: 'Engineer' },
      },
    });
    expect(member.avatarUrl).toBe('data:image/webp;base64,UklGR');
    expect(member.email).toBe('a@b');
    expect(member.title).toBe('Engineer');
  });

  it('a redacted record shows none', () => {
    const member: ReturnType<typeof mapWasmMember> = mapWasmMember({ id: 'bob', name: 'Bob', metadata: {} });
    expect(member.avatarUrl).toBeUndefined();
    expect(member.email).toBeUndefined();
    expect(member.title).toBeUndefined();
  });

  it('the own record clears a removed field and keeps a previous avatar', () => {
    expect(currentUserProfileFromMetadata({}, 'data:image/webp;base64,AA')).toEqual({
      avatarUrl: 'data:image/webp;base64,AA', email: undefined, title: undefined,
      showProfileToStrangers: true,
    });
  });
});
