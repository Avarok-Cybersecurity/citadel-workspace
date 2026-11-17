/**
 * The settings screens' choices and the server's policy are one mapping each way, and a
 * member's picker keeps to the nodes the server would accept (it refuses anything wider).
 */
import { describe, expect, it } from 'vitest';
import type { DomainNode } from 'citadel-workspace-client-ts';
import {
  inWorkspaceScope, personalChoiceOf, personalPolicyOf, trustNodeOptions, workspaceChoiceOf, workspacePolicyOf,
} from '../trust-choice';

const node = (id: string, name: string, parent: string): DomainNode =>
  ({ id, name, parent_id: parent, entity_type: { Child: 'Team' } }) as unknown as DomainNode;
const NODES: Record<string, DomainNode> = {
  eng: node('eng', 'Engineering', 'workspace-root'),
  backend: node('backend', 'Backend', 'eng'),
  sales: node('sales', 'Sales', 'workspace-root'),
};
const ENG: { NodeLevelTrusted: { node_id: string } } = { NodeLevelTrusted: { node_id: 'eng' } };

describe('the trust choices', () => {
  it('round-trip the workspace policy', () => {
    for (const policy of ['Strict', 'AllTrusted', ENG] as const) {
      expect(workspacePolicyOf(workspaceChoiceOf(policy), 'eng')).toEqual(policy);
    }
    expect(workspacePolicyOf('NodeLevelTrusted', null)).toBeNull();
  });

  it('read a member\'s own policy, following the workspace when there is none', () => {
    expect(personalChoiceOf(null)).toBe('follow');
    expect(personalChoiceOf('Strict')).toBe('ask');
    expect(personalChoiceOf(ENG)).toBe('node');
    expect(personalPolicyOf('follow', 'eng')).toBeNull();
    expect(personalPolicyOf('ask', null)).toBe('Strict');
    expect(personalPolicyOf('node', null)).toBeUndefined();
    expect(personalPolicyOf('node', 'eng')).toEqual(ENG);
  });

  it('keep a member\'s nodes inside the workspace\'s scope', () => {
    expect(inWorkspaceScope(NODES, ENG, 'backend')).toBe(true);
    expect(inWorkspaceScope(NODES, ENG, 'eng')).toBe(true);
    expect(inWorkspaceScope(NODES, ENG, 'sales')).toBe(false);
    expect(inWorkspaceScope(NODES, 'AllTrusted', 'sales')).toBe(true);
    expect(inWorkspaceScope(NODES, 'Strict', 'eng')).toBe(false);
  });

  it('name nodes by path and live level, in path order', () => {
    const labels: string[] = trustNodeOptions(NODES, (id: string): boolean => inWorkspaceScope(NODES, ENG, id), (): string => 'Squad')
      .map((option) => option.label);
    expect(labels).toEqual(['Engineering · Squad', 'Engineering › Backend · Squad']);
  });
});
