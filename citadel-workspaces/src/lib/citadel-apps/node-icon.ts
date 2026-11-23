/**
 * The icon a tree row draws for a node: its app's when the node is a document whose app record
 * reads, the installed app's when it is an app's page, otherwise its level's from the schema. One
 * function, so the four rows that draw a node (sibling, child, ancestor, search result) cannot
 * disagree about which nodes are documents or pages.
 */
import type { ComponentType } from 'react';
import { getEntityIcon, type NodeEntityType } from '@/lib/entity-type-registry';
import type { MetadataSource } from '@/lib/workspace-metadata/metadata-document';
import { installedAppIcon } from '@/components/citadel-apps/InstalledAppIcon';
import { decodeNodeApp, type NodeAppBinding } from './node-app-metadata';
import { citadelApp } from './registry';

export function nodeIcon(node: { entity_type: NodeEntityType; metadata: MetadataSource }): ComponentType<{ className?: string }> {
  const binding: NodeAppBinding = decodeNodeApp(node.metadata);
  if (binding.kind === 'document') return citadelApp(binding.app).icon;
  if (binding.kind === 'installed') return installedAppIcon(binding.app);
  return getEntityIcon(node.entity_type);
}
