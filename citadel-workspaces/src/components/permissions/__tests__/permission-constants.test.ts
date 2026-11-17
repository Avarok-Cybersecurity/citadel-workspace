import { describe, it, expect } from 'vitest';
import * as constants from '../permission-constants';
import { PERMISSION_CATEGORIES } from '../permission-constants';
import { Permission } from '@/lib/permissions-service/types';

/**
 * These used to assert a hand-written model that lived in permission-constants
 * itself, so they passed while disagreeing with the server on what a role
 * grants — the earlier version required Member to have EditContent, which the
 * backend refuses. They now assert the presentation layer is a faithful
 * rendering of the canonical model; Rust parity is checked separately by
 * scripts/check-permission-parity.mjs. What a ROLE grants is not modelled in
 * the UI at all any more: it is the server's editable table, read live.
 */
describe('permission-constants', () => {
  describe('PERMISSION_CATEGORIES', () => {
    it('covers every permission exactly once', () => {
      const ids: string[] = Object.values(PERMISSION_CATEGORIES).flat().map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual([...Object.values(Permission)].sort());
    });

    it('gives every permission a label and a description', () => {
      for (const perm of Object.values(PERMISSION_CATEGORIES).flat()) {
        expect(perm.label, `${perm.id} has no label`).toBeTruthy();
        expect(perm.description, `${perm.id} has no description`).toBeTruthy();
      }
    });

    it('places Manage roles with the other user-management permissions', () => {
      expect(PERMISSION_CATEGORIES['User Management'].map((p) => p.id)).toContain(Permission.ManageRoles);
    });

    it('puts every app permission, and only those, under Apps', () => {
      const apps: Permission[] = PERMISSION_CATEGORIES['Apps'].map((p) => p.id);
      const appVariants: Permission[] = Object.values(Permission).filter((p) => p.startsWith('App'));
      expect(appVariants).toHaveLength(21);
      expect([...apps].sort()).toEqual([...appVariants].sort());
    });

    it('keeps no role table beside the categories', () => {
      expect(Object.keys(constants).sort()).toEqual(['PERMISSION_CATEGORIES']);
    });

    it('groups permissions under readable headings', () => {
      expect(Object.keys(PERMISSION_CATEGORIES)).toEqual(
        expect.arrayContaining(['Content', 'Messaging', 'Files', 'Nodes', 'Workspace']),
      );
    });
  });
});
