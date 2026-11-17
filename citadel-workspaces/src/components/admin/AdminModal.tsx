import { useEffect, useState  , type ComponentType } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, Users, MessageSquare } from 'lucide-react';
import { GeneralTab } from './tabs/GeneralTab';
import { MembersTab } from './tabs/MembersTab';
import { ChatSettingsTab } from './tabs/ChatSettingsTab';
import { AdminModalProps, EntityData } from './types';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { getEntityMetadata , type EntityTypeMetadata } from '@/lib/entity-type-registry';
import { debugLog } from '@/lib/debug-config';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

export function AdminModal({
  isOpen,
  onClose,
  entityType,
  entityId,
  defaultTab = 'general',
}: AdminModalProps): JSX.Element {
  const { state } = useWorkspace();
  const [entity, setEntity] = useState<EntityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen || !entityId) {
      setEntity(null);
      setLoading(false);
      return;
    }

    const loadEntity = (): void => {
      setLoading(true);
      try {
        if (entityType === 'workspace') {
          if (state.workspace) {
            setEntity({
              id: state.workspace.id,
              name: state.workspace.name,
              description: state.workspace.description || '',
            });
          }
        } else {
          const node: DomainNode = state.nodes[entityId];
          if (node) {
            setEntity({
              id: node.id,
              name: node.name,
              description: node.description || '',
            });
          }
        }
      } catch (error) {
        debugLog('AdminModal', 'Failed to load entity:', error);
      } finally {
        setLoading(false);
      }
    };

    loadEntity();
  }, [isOpen, entityType, entityId, state.workspace, state.nodes]);

  const handleOpenChange = (open: boolean): void => {
    if (!open) {
      onClose();
    }
  };

  const meta: EntityTypeMetadata = getEntityMetadata(entityType);
  const EntityIcon: ComponentType<{ className?: string; }> = meta.icon;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[700px] bg-card border-surface"
        data-testid="admin-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-foreground text-xl flex items-center">
            <EntityIcon className="h-5 w-5 mr-2" />
            {loading ? `Loading ${meta.label}...` : `${entity?.name || meta.label} Settings`}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Manage {meta.label.toLowerCase()} settings, members, and chat configuration
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={defaultTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-3 bg-background h-12">
            <TabsTrigger
              value="general"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground gap-1.5"
              data-testid="admin-tab-general"
             aria-label="General"
            >
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">General</span>
            </TabsTrigger>
            <TabsTrigger
              value="members"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground gap-1.5"
              data-testid="admin-tab-members"
             aria-label="Members"
            >
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Members</span>
            </TabsTrigger>
            <TabsTrigger
              value="chat"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground gap-1.5"
              data-testid="admin-tab-chat"
             aria-label="Chat"
            >
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Chat</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="mt-6" data-testid="admin-content-general">
            <GeneralTab
              entityType={entityType}
              entityId={entityId}
              onClose={onClose}
            />
          </TabsContent>

          <TabsContent value="members" className="mt-6" data-testid="admin-content-members">
            <MembersTab
              entityType={entityType}
              entityId={entityId}
              onClose={onClose}
            />
          </TabsContent>

          <TabsContent value="chat" className="mt-6" data-testid="admin-content-chat">
            <ChatSettingsTab
              entityType={entityType}
              entityId={entityId}
              onClose={onClose}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
