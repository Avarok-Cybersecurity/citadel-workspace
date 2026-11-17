/**
 * Which templates a node is offered, from where its level sits in the live schema.
 *
 * A level the schema permits directly under the workspace gets the top-level templates, every
 * other level the nested ones, and the workspace itself the top-level ones (what its home page
 * has always offered). Only the schema's structure is read: renaming a level, or a schema whose
 * levels are called something else entirely, cannot move a node to other templates.
 */
import { getEntityTypeString, type NodeEntityType } from '@/lib/entity-type-registry';
import type { NestingRule, TreeSchema } from 'citadel-workspace-client-ts';
import { TemplateCategory } from './types';

/** Null while the schema has not arrived: a child level cannot be placed without it. */
export function templateCategoryFor(level: NodeEntityType, schema: TreeSchema | null): TemplateCategory | null {
  if (level === 'Workspace') return TemplateCategory.TOP_LEVEL;
  if (!schema) return null;
  const topLevel: readonly string[] =
    schema.rules.find((rule: NestingRule): boolean => rule.parent_type === 'Workspace')?.allowed_child_types ?? [];
  return topLevel.includes(getEntityTypeString(level)) ? TemplateCategory.TOP_LEVEL : TemplateCategory.NESTED;
}
