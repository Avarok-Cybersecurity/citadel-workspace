/**
 * The workspace-settings form sends exactly what the owner changed, and refuses an icon the
 * server would refuse before sending it.
 *
 * Only changed fields travel: an untouched name sent back with the save would overwrite a
 * colleague's rename made while the dialog was open. And an icon over the server's 32 KB limit
 * (a PNG fallback where the browser cannot encode WebP) is caught here with a sentence the owner
 * can act on, rather than a server error after the upload.
 *
 * No mocks: a pure function.
 */
import { describe, it, expect } from 'vitest';
import { profileChangeFrom, MAX_ICON_BYTES, type ProfileForm } from '../profile-change';

const PNG_B64: string = 'iVBORw0KGgo=';
const base: ProfileForm = { name: 'Avarok', description: 'We build things', icon: null };

describe('a workspace-settings save', () => {
  it('sends nothing when nothing changed', () => {
    expect(profileChangeFrom(base, { ...base, name: ' Avarok ' })).toEqual({ ok: true, change: null });
  });

  it('sends only the changed fields', () => {
    expect(profileChangeFrom(base, { ...base, name: 'Avarok Labs' })).toEqual({ ok: true, change: { name: 'Avarok Labs' } });
    expect(profileChangeFrom(base, { ...base, description: '' })).toEqual({ ok: true, change: { description: '' } });
  });

  it('sets a new icon as a data URL, and clears a removed one', () => {
    expect(profileChangeFrom(base, { ...base, icon: PNG_B64 })).toEqual({
      ok: true,
      change: { logo: { Set: { data_url: `data:image/png;base64,${PNG_B64}` } } },
    });
    const withIcon: ProfileForm = { ...base, icon: `data:image/png;base64,${PNG_B64}` };
    expect(profileChangeFrom(withIcon, { ...withIcon, icon: null })).toEqual({ ok: true, change: { logo: 'Clear' } });
    expect(profileChangeFrom(withIcon, withIcon)).toEqual({ ok: true, change: null });
  });

  it('refuses an empty name and an icon over the limit, saying why', () => {
    const empty: ReturnType<typeof profileChangeFrom> = profileChangeFrom(base, { ...base, name: '   ' });
    expect(empty.ok).toBe(false);
    const big: string = 'A'.repeat(Math.ceil((MAX_ICON_BYTES + 1) / 3) * 4);
    const tooBig: ReturnType<typeof profileChangeFrom> = profileChangeFrom(base, { ...base, icon: big });
    expect(tooBig).toEqual({ ok: false, reason: expect.stringContaining('32 KB') });
  });
});
