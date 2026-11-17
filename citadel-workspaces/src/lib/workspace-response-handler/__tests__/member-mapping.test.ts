import { describe, it, expect } from 'vitest';
import { mapWasmMember } from '../member-mapping';
import type { MappedMember } from '@/lib/workspace-response-handler/member-mapping';

/**
 * Unit tests for `mapWasmMember`. The mapping is the single normalisation
 * boundary between the raw WASM `User` shape (`{ name, ... }`) and the
 * UI's expected `{ username, displayName, ... }` shape, so any silent
 * field drop here ripples into "members vanish from the sidebar"
 * symptoms downstream.
 */
describe('mapWasmMember', () => {
  it('preserves a fully-populated record verbatim in the canonical fields', () => {
    const out: MappedMember = mapWasmMember({
      id: 'user-1',
      username: 'alice',
      displayName: 'Alice Anderson',
      role: 'admin',
      name: 'should-not-shadow-username',
    });
    expect(out.id).toBe('user-1');
    expect(out.username).toBe('alice');
    expect(out.displayName).toBe('Alice Anderson');
    expect(out.role).toBe('admin');
  });

  it('takes the username from `id` and the display name from `name`', () => {
    // The wire User: `id` is the account username, `name` the registered full name.
    const out: MappedMember = mapWasmMember({ id: 'bob0924', name: 'Bob Brown' });
    expect(out.username).toBe('bob0924');
    expect(out.displayName).toBe('Bob Brown');
  });

  it('falls back to `name` when there is no id', () => {
    const out: MappedMember = mapWasmMember({ name: 'bob' });
    expect(out.username).toBe('bob');
    expect(out.displayName).toBe('bob');
  });

  it('falls back to id when neither name nor username is present', () => {
    const out: MappedMember = mapWasmMember({ id: 'u-7' });
    expect(out.username).toBe('u-7');
    expect(out.displayName).toBe('u-7');
  });

  it('returns an empty object-shape with empty strings rather than crashing on {}', () => {
    const out: MappedMember = mapWasmMember({});
    expect(out.id).toBeUndefined();
    expect(out.username).toBe('');
    expect(out.displayName).toBe('');
    expect(out.role).toBeUndefined();
  });

  it('coerces a numeric id to string instead of dropping it', () => {
    // Regression: the original implementation guarded on `typeof raw.id ===
    // 'string'` and silently set id: undefined for numeric ids, which the
    // downstream `if (!id)` filter then dropped from the member list.
    const out: MappedMember = mapWasmMember({ id: 42, username: 'eve' });
    expect(out.id).toBe('42');
    expect(out.username).toBe('eve');
  });

  it('coerces a bigint id to string', () => {
    const out: MappedMember = mapWasmMember({ id: 12345678901234567890n, username: 'frank' });
    expect(out.id).toBe('12345678901234567890');
  });

  it('drops obviously bogus id types (boolean, object) rather than coercing them', () => {
    const out: MappedMember = mapWasmMember({ id: true, username: 'g' });
    expect(out.id).toBeUndefined();
    expect(out.username).toBe('g');
  });

  it('preserves arbitrary extra fields unchanged via the spread', () => {
    const out: MappedMember = mapWasmMember({ id: 'u', name: 'x', joined_at: 12345, online: true });
    expect((out as Record<string, unknown>).joined_at).toBe(12345);
    expect((out as Record<string, unknown>).online).toBe(true);
  });
});

/**
 * A member's role is `workspace_roles[root]`, an id into the role table. It reaches the page as
 * a JS Map from WASM (serde_wasm_bindgen's default) and as an object from JSON, and both must
 * read: Object.keys on a Map is empty, which would leave every member roleless.
 */
describe('the role id a member holds', () => {
  it('is read from a Map, as WASM sends it', () => {
    expect(mapWasmMember({ id: 'ada', workspace_roles: new Map([['hq', 'member'], ['workspace-root', 'role-lead']]) }).roleId).toBe('role-lead');
  });
  it('is read from an object, as JSON sends it', () => {
    expect(mapWasmMember({ id: 'ada', workspace_roles: { 'workspace-root': 'admin' } }).roleId).toBe('admin');
  });
  it('is undefined when the root holds none, or the field is absent', () => {
    expect(mapWasmMember({ id: 'ada', workspace_roles: new Map([['hq', 'member']]) }).roleId).toBeUndefined();
    expect(mapWasmMember({ id: 'ada' }).roleId).toBeUndefined();
  });
});
