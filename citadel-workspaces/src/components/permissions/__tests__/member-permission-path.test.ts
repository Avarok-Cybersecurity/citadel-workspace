/**
 * Where one member's grant comes from, read off the server's answer at each
 * level. The level names are renamed from the default template's on purpose:
 * nothing here may depend on "Office" or "Room".
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { setTreeSchema } from '@/lib/entity-type-registry';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import type { DomainNode, TreeSchema } from '@/components/layout/sidebar/tree-node-types';
import { grantSource, levelPhrase, type PermissionLevel } from '../member-permission-path';
import { domainPath } from '@/lib/domain-path';
import { changeCount, permissionChanges } from '../permission-changes';
import type { PermissionsLoad } from '../use-loaded-permissions';

const config = (type: string, label: string): TreeSchema['entity_type_configs'][number] => ({
  type_name: type, icon: 'folder', label, plural_label: `${label}s`, name_placeholder: '', description_placeholder: '',
});

function node(id: string, parent: string | null, type: string, name: string): DomainNode {
  return {
    id, parent_id: parent, entity_type: { Child: type }, depth: 0, name, description: '', owner_id: '',
    members: [], children: [], mdx_content: '', mdx_content_hash: null, rules: null, chat_enabled: false,
    chat_channel_id: null, default_permissions: {} as DomainNode['default_permissions'], metadata: [],
    allowed_child_types: [], is_default: false, created_at: 0n, updated_at: 0n,
  };
}

const NODES: Record<string, DomainNode> = Object.fromEntries([
  node('hq', WORKSPACE_ROOT_ID, 'Office', 'HQ'),
  node('lab', WORKSPACE_ROOT_ID, 'Office', 'Lab'),
  node('standup', 'hq', 'Room', 'Standup'),
].map((n: DomainNode) => [n.id, n]));

const loaded = (...permissions: string[]): PermissionsLoad => ({ status: 'loaded', permissions: new Set(permissions), role: 'Member', roleId: 'member' });

beforeAll(() => {
  setTreeSchema({ entity_type_configs: [config('Workspace', 'Company'), config('Office', 'Studio'), config('Room', 'Booth')] } as unknown as TreeSchema);
});

describe('the path an edit applies along', () => {
  it('runs from the workspace down to the level opened, named by the live schema', () => {
    const path: PermissionLevel[] = domainPath(NODES, 'standup', 'Acme');
    expect(path.map((level: PermissionLevel) => level.id)).toEqual([WORKSPACE_ROOT_ID, 'hq', 'standup']);
    expect(path.map(levelPhrase)).toEqual(['Company Acme', 'Studio HQ', 'Booth Standup']);
  });

  it('is the workspace alone when the workspace is what was opened', () => {
    expect(domainPath(NODES, WORKSPACE_ROOT_ID, 'Acme').map((level: PermissionLevel) => level.id)).toEqual([WORKSPACE_ROOT_ID]);
  });

  it('keeps an unknown level as the one edited instead of turning it into the workspace', () => {
    const path: PermissionLevel[] = domainPath(NODES, 'gone', 'Acme');
    expect(path[path.length - 1].id).toBe('gone');
  });
});

describe('where a grant comes from', () => {
  const path: PermissionLevel[] = domainPath(NODES, 'standup', 'Acme');

  it('is the highest level that already grants it', () => {
    const loads: Record<string, PermissionsLoad> = {
      [WORKSPACE_ROOT_ID]: loaded('ViewContent'),
      hq: loaded('ViewContent', 'SendMessages'),
      standup: loaded('ViewContent', 'SendMessages', 'UploadFiles'),
    };
    expect(grantSource('ViewContent', path, loads)).toEqual({ kind: 'inherited', from: path[0] });
    expect(grantSource('SendMessages', path, loads)).toEqual({ kind: 'inherited', from: path[1] });
    expect(grantSource('UploadFiles', path, loads)).toEqual({ kind: 'here' });
    expect(grantSource('DeleteNode', path, loads)).toEqual({ kind: 'none' });
  });

  it('is unknown until every level has answered', () => {
    const loads: Record<string, PermissionsLoad> = { [WORKSPACE_ROOT_ID]: loaded(), hq: { status: 'loading' }, standup: loaded('UploadFiles') };
    expect(grantSource('UploadFiles', path, loads)).toBeNull();
  });
});

describe('what Save sends', () => {
  it('is the difference from the server, both ways, and nothing when nothing changed', () => {
    const server: Set<string> = new Set(['ViewContent', 'UploadFiles']);
    expect(permissionChanges(server, new Set(['ViewContent', 'SendMessages']))).toEqual({ added: ['SendMessages'], removed: ['UploadFiles'] });
    expect(changeCount(permissionChanges(server, new Set(server)))).toBe(0);
  });
});
