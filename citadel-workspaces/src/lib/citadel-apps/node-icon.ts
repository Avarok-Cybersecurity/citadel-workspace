/**
 * The icon a tree row draws for a node: its app's when the node is a document whose app record
 * reads, otherwise its level's from the schema. One function, so the four rows that draw a node
 * (sibling, child, ancestor, search result) cannot disagree about which nodes are documents.
 */
import type { ComponentType } from 'react';
import { getEntityIcon, type NodeEntityType } from '@/lib/entity-type-registry';
import type { MetadataSource } from '@/lib/workspace-metadata/metadata-document';
import { nodeAppState, type NodeAppState } from './node-app-metadata';
import { citadelApp } from './registry';

export function nodeIcon(node: { entity_type: NodeEntityType; metadata: MetadataSource }): ComponentType<{ className?: string }> {
  const state: NodeAppState = nodeAppState(node.metadata);
  return state.kind === 'app' ? citadelApp(state.app).icon : getEntityIcon(node.entity_type);
}
