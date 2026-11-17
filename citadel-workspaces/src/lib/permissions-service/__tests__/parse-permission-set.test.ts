/**
 * Parsing a member's permissions must not allocate the whole enum per permission.
 *
 * `Object.values(Permission).includes(...)` built a fresh array on every iteration of a loop
 * over one domain's permissions. The behaviour it guards — unknown strings are dropped — is
 * what these tests pin, so the hoisted set cannot quietly change what is accepted.
 */
import { describe, it, expect } from 'vitest';
import { Permission } from '../types';
import { parsePermissionSet } from '../cache';

describe('parsePermissionSet', () => {
  it('keeps every permission the server can name', () => {
    const all: string[] = Object.values(Permission) as string[];
    const parsed: Set<Permission> = parsePermissionSet(all);
    expect(parsed.size).toBe(all.length);
    for (const p of all) expect(parsed.has(p as Permission)).toBe(true);
  });

  it('drops what is not a permission, rather than trusting the wire', () => {
    const parsed: Set<Permission> = parsePermissionSet(['NotAPermission', '', 'ViewContent__', '__proto__']);
    expect(parsed.size).toBe(0);
  });

  it('is unaffected by duplicates and order', () => {
    const one: string = Object.values(Permission)[0] as string;
    expect(parsePermissionSet([one, one, one]).size).toBe(1);
  });
});
