import type { NestingRule, TreeSchema } from './tree-node-types';

/** What "add a child here" has to do, from the types the live schema allows under a parent. */
export type ChildTypeChoice =
  | { kind: 'none' }
  | { kind: 'one'; type: string }
  | { kind: 'pick'; types: string[] };

export function childTypeChoice(allowed: readonly string[] | null | undefined): ChildTypeChoice {
  const types: string[] = [...new Set(allowed ?? [])];
  if (types.length === 0) return { kind: 'none' };
  if (types.length === 1) return { kind: 'one', type: types[0] };
  return { kind: 'pick', types };
}

const NO_TYPES: readonly string[] = Object.freeze([]);

/** The types the live schema allows directly under the workspace; none until the schema arrives. */
export function topLevelChildTypes(schema: TreeSchema | null): readonly string[] {
  return schema?.rules.find((r: NestingRule): boolean => r.parent_type === 'Workspace')?.allowed_child_types ?? NO_TYPES;
}
