/**
 * Permission node sections: ChildNodePermissionSection, ParentNodePermissionSection
 */

import { useEffect , type ComponentType } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { usePermissions   } from '@/contexts/PermissionsContext';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { getEntityMetadata, type NodeEntityType , type EntityTypeMetadata } from '@/lib/entity-type-registry';
import { RoleBadge, GroupedPermissionTable } from './PermissionWidgets';

/**
 * Child node permission section -- icon derived from entity-type-registry.
 */
export function ChildNodePermissionSection({
  nodeId,
  nodeName,
  entityType,
}: {
  nodeId: string;
  nodeName: string;
  entityType: NodeEntityType;
}): JSX.Element {
  const { fetchPermissionsForDomain, loading } = usePermissions();
  const metadata: EntityTypeMetadata = getEntityMetadata(entityType);
  const Icon: ComponentType<{ className?: string; }> = metadata.icon;

  useEffect(() => {
    runAsyncSetup(async () => {
      await fetchPermissionsForDomain(nodeId);
    });
  }, [nodeId, fetchPermissionsForDomain]);

  return (
    <AccordionItem value={`child-${nodeId}`} className="border-border/30 border-l-2 border-l-primary-accent/30 ml-4">
      <AccordionTrigger className="text-foreground/80 hover:text-foreground hover:no-underline py-2 pl-3">
        <div className="flex items-center gap-3">
          <Icon className="h-4 w-4 text-primary-accent" />
          <span>{nodeName}</span>
          <RoleBadge />
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
      </AccordionTrigger>
      <AccordionContent className="pl-6">
        <GroupedPermissionTable domainId={nodeId} />
      </AccordionContent>
    </AccordionItem>
  );
}

/**
 * Parent node permission section with nested children -- icon derived from entity-type-registry.
 */
export function ParentNodePermissionSection({
  nodeId,
  nodeName,
  entityType,
  children,
}: {
  nodeId: string;
  nodeName: string;
  entityType: NodeEntityType;
  children: Array<{ id: string; name: string; entityType: NodeEntityType }>;
}): JSX.Element {
  const { fetchPermissionsForDomain, loading } = usePermissions();
  const metadata: EntityTypeMetadata = getEntityMetadata(entityType);
  const Icon: ComponentType<{ className?: string; }> = metadata.icon;

  useEffect(() => {
    runAsyncSetup(async () => {
      await fetchPermissionsForDomain(nodeId);
    });
  }, [nodeId, fetchPermissionsForDomain]);

  return (
    <AccordionItem value={`node-${nodeId}`} className="border-border/30 border-l-2 border-l-primary-accent/30 ml-2">
      <AccordionTrigger className="text-foreground/80 hover:text-foreground hover:no-underline py-2 pl-3">
        <div className="flex items-center gap-3">
          <Icon className="h-4 w-4 text-primary-accent" />
          <span>{nodeName}</span>
          <RoleBadge />
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
      </AccordionTrigger>
      <AccordionContent className="pl-4">
        <div className="mb-4">
          <GroupedPermissionTable domainId={nodeId} />
        </div>

        {children.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-muted-foreground mb-2 pl-2">Children</h4>
            <Accordion type="multiple" className="w-full">
              {children.map((child) => (
                <ChildNodePermissionSection
                  key={child.id}
                  nodeId={child.id}
                  nodeName={child.name}
                  entityType={child.entityType}
                />
              ))}
            </Accordion>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
