/**
 * Which templates a node is offered is decided by where its level sits in the live schema,
 * never by what the level is called.
 *
 * The page passed `TemplateCategory.OFFICE` for every node, and the selector turned the
 * category back into the type name "Office" to find its label: a renamed or differently named
 * level was shown as "Office", and the room templates could not be reached at all.
 *
 * No mocks: the real templates and the real derivation over schemas.
 */
import { describe, it, expect } from 'vitest';
import type { TreeSchema } from 'citadel-workspace-client-ts';
import { getEntityMetadata, setTreeSchema } from '@/lib/entity-type-registry';
import { getTemplatesByCategory, TemplateCategory, templateCategoryFor } from '..';

// Test default (PCND): the default schema's nesting, with whatever labels a case gives it.
function schema(rules: Array<[string, string[]]>, labels: Record<string, string> = {}): TreeSchema {
  return {
    id: 'test', name: 'test', max_depth: null,
    rules: rules.map(([parent_type, allowed_child_types]) => ({ parent_type, allowed_child_types })),
    entity_type_configs: Object.entries(labels).map(([type_name, label]) => ({
      type_name, label, plural_label: `${label}s`, icon: 'folder', name_placeholder: '', description_placeholder: '',
    })),
  };
}

const DEFAULT: Array<[string, string[]]> = [['Workspace', ['Office']], ['Office', ['Room', 'Office']], ['Room', ['Room']]];

describe('the templates a node is offered', () => {
  it('in the default schema: offices and the workspace get the top-level ones, rooms the nested ones', () => {
    const s: TreeSchema = schema(DEFAULT);
    expect(templateCategoryFor('Workspace', s)).toBe(TemplateCategory.TOP_LEVEL);
    expect(templateCategoryFor({ Child: 'Office' }, s)).toBe(TemplateCategory.TOP_LEVEL);
    expect(templateCategoryFor({ Child: 'Room' }, s)).toBe(TemplateCategory.NESTED);
    expect(getTemplatesByCategory(TemplateCategory.TOP_LEVEL).map((t) => t.id)).toContain('office-general');
    expect(getTemplatesByCategory(TemplateCategory.NESTED).map((t) => t.id)).toContain('room-meeting');
  });

  it('does not change when an admin renames a level', () => {
    const renamed: TreeSchema = schema(DEFAULT, { Office: 'Department', Room: 'Team' });
    // Live, as the app registers it on tree:schema:loaded, so the rename is what the UI shows.
    setTreeSchema(renamed);
    expect(getEntityMetadata({ Child: 'Office' }).label).toBe('Department');
    expect(templateCategoryFor({ Child: 'Office' }, renamed)).toBe(TemplateCategory.TOP_LEVEL);
    expect(templateCategoryFor({ Child: 'Room' }, renamed)).toBe(TemplateCategory.NESTED);
  });

  it('follows the structure of a schema whose levels have other names entirely', () => {
    const estate: TreeSchema = schema([['Workspace', ['City']], ['City', ['Building']], ['Building', ['Floor']]]);
    expect(templateCategoryFor({ Child: 'City' }, estate)).toBe(TemplateCategory.TOP_LEVEL);
    expect(templateCategoryFor({ Child: 'Building' }, estate)).toBe(TemplateCategory.NESTED);
    expect(templateCategoryFor({ Child: 'Office' }, estate)).toBe(TemplateCategory.NESTED);
  });

  it('cannot place a child level before the schema has arrived', () => {
    expect(templateCategoryFor({ Child: 'Office' }, null)).toBeNull();
    expect(templateCategoryFor('Workspace', null)).toBe(TemplateCategory.TOP_LEVEL);
  });
});
