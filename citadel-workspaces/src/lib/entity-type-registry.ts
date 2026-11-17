/**
 * Entity Type Registry — thin accessor over TreeSchema display metadata.
 *
 * All display metadata (icons, labels, placeholders) is defined in the
 * Rust TreeSchema and sent to the frontend via the tree:schema:loaded event.
 * This module resolves icon name strings to Lucide React components and
 * provides the same public API as before.
 */

import type { ComponentType } from 'react';
import type { TreeSchema, EntityTypeConfig } from 'citadel-workspace-client-ts';
import { isVariant } from 'citadel-workspace-client-ts';
import {
  Building2,
  Briefcase,
  MessageSquare,
  Folder,
  Users,
  FolderKanban,
  Layers,
} from 'lucide-react';

// Re-export the canonical NodeEntityType
export type NodeEntityType = "Workspace" | { Child: string };

export interface EntityTypeMetadata {
  icon: ComponentType<{ className?: string }>;
  label: string;
  pluralLabel: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
}

/** Map from Lucide icon kebab-case names to React components. */
const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  'building-2': Building2,
  'briefcase': Briefcase,
  'message-square': MessageSquare,
  'folder': Folder,
  'users': Users,
  'folder-kanban': FolderKanban,
  'layers': Layers,
};

/** Schema-driven config store. Populated by setTreeSchema(). */
let schemaConfigs: Map<string, EntityTypeConfig> | null = null;

/** Called from useNodeEventSetup when tree:schema:loaded fires. */
export function setTreeSchema(schema: TreeSchema): void {
  schemaConfigs = new Map(
    schema.entity_type_configs.map(c => [c.type_name, c])
  );
}

/** Resolve a Lucide icon name string to its React component. */
function resolveIcon(iconName: string): ComponentType<{ className?: string }> {
  return ICON_MAP[iconName] ?? Folder;
}

/** Extract the string name from a NodeEntityType. */
export function getEntityTypeString(entityType: NodeEntityType): string {
  if (entityType === 'Workspace') return 'Workspace';
  if (isVariant(entityType as Record<string, unknown>, 'Child')) {
    return (entityType as { Child: string }).Child;
  }
  return 'Node';
}

/** Get display metadata for an entity type from the TreeSchema (SSOT). */
export function getEntityMetadata(entityType: NodeEntityType | string): EntityTypeMetadata {
  const key: string = typeof entityType === 'string'
    ? entityType
    : getEntityTypeString(entityType);

  // Primary: read from schema (SSOT)
  if (schemaConfigs) {
    const config: EntityTypeConfig | undefined = schemaConfigs.get(key);
    if (config) {
      return {
        icon: resolveIcon(config.icon),
        label: config.label,
        pluralLabel: config.plural_label,
        namePlaceholder: config.name_placeholder,
        descriptionPlaceholder: config.description_placeholder,
      };
    }
  }

  // Fallback for unknown entity types — derive from the type name
  return {
    icon: Folder,
    label: key,
    pluralLabel: `${key}s`,
    namePlaceholder: `Enter ${key.toLowerCase()} name...`,
    descriptionPlaceholder: `Describe this ${key.toLowerCase()}...`,
  };
}

/** Get just the icon component for an entity type. */
export function getEntityIcon(entityType: NodeEntityType | string): ComponentType<{ className?: string }> {
  return getEntityMetadata(entityType).icon;
}
