import { useState, useEffect, useRef  , type MutableRefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { AdminTabProps } from '../types';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import WorkspaceService from '@/lib/workspace-service';
import { Loader2 } from 'lucide-react';
import { debugLog } from '@/lib/debug-config';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

export function GeneralTab({ entityType, entityId, onClose: _onClose }: AdminTabProps): JSX.Element {
  const { state } = useWorkspace();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalName, setOriginalName] = useState('');
  const [originalDescription, setOriginalDescription] = useState('');
  const seededKeyRef: MutableRefObject<string | null> = useRef<string | null>(null);
  const dirtyRef: MutableRefObject<boolean> = useRef(false);

  useEffect(() => {
    // `state.nodes` is re-minted by ANY node event in the workspace — including a
    // teammate saving an unrelated document — so this effect re-runs constantly.
    // Re-seeding then replaced whatever the admin was typing AND reset the
    // originals, flipping hasChanges back to false so Save greyed out: the work
    // was gone and the UI denied it had existed.
    //
    // An untouched form still follows the store, which is what makes a genuine
    // remote rename visible. Only unsaved edits are protected.
    const entityKey: string = `${entityType}:${entityId}`;
    if (seededKeyRef.current === entityKey && dirtyRef.current) return;
    seededKeyRef.current = entityKey;

    const loadData = (): void => {
      setLoading(true);
      try {
        if (entityType === 'workspace' && state.workspace) {
          setName(state.workspace.name);
          setDescription(state.workspace.description || '');
          setOriginalName(state.workspace.name);
          setOriginalDescription(state.workspace.description || '');
        } else {
          const node: DomainNode = state.nodes[entityId];
          if (node) {
            setName(node.name);
            setDescription(node.description || '');
            setOriginalName(node.name);
            setOriginalDescription(node.description || '');
          }
        }
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [entityType, entityId, state.workspace, state.nodes]);

  useEffect(() => {
    const dirty: boolean = name !== originalName || description !== originalDescription;
    setHasChanges(dirty);
    dirtyRef.current = dirty;
  }, [name, description, originalName, originalDescription]);

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) {
      toast({
        title: 'Error',
        description: 'Name is required',
        variant: 'destructive',
      });
      return;
    }

    if (name.length < 3 || name.length > 100) {
      toast({
        title: 'Error',
        description: 'Name must be between 3 and 100 characters',
        variant: 'destructive',
      });
      return;
    }

    if (description.length > 500) {
      toast({
        title: 'Error',
        description: 'Description must be 500 characters or less',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      if (entityType === 'workspace') {
        await WorkspaceService.updateWorkspace(name, description);
      } else {
        await WorkspaceService.updateNode(entityId, { name, description });
      }

      toast({
        title: 'Success',
        description: `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} updated successfully`,
        variant: 'success',
      });

      setOriginalName(name);
      setOriginalDescription(description);
      setHasChanges(false);
    } catch (error) {
      debugLog('GeneralTab', 'Failed to update entity:', error);
      toast({
        title: 'Error',
        description: `Failed to update ${entityType}. Please try again.`,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = (): void => {
    setName(originalName);
    setDescription(originalDescription);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8" data-testid="general-tab-loading">
        <Loader2 className="h-6 w-6 animate-spin text-primary-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="general-tab-content">
      <div className="space-y-2">
        <Label htmlFor="entity-name" className="text-foreground">
          Name <span className="text-destructive-emphasis">*</span>
        </Label>
        <Input
          id="entity-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Enter ${entityType} name`}
          className="bg-card border-surface text-foreground placeholder:text-muted-foreground"
          maxLength={100}
          data-testid="general-name-input"
        />
        <p className="text-xs text-muted-foreground">{name.length}/100 characters</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="entity-description" className="text-foreground">
          Description
        </Label>
        <Textarea
          id="entity-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={`Enter ${entityType} description (optional)`}
          className="bg-card border-surface text-foreground placeholder:text-muted-foreground min-h-[100px]"
          maxLength={500}
          data-testid="general-description-input"
        />
        <p className="text-xs text-muted-foreground">{description.length}/500 characters</p>
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <Button
          variant="outline"
          onClick={handleCancel}
          disabled={!hasChanges || saving}
          className="border-border text-foreground hover:bg-card"
          data-testid="general-cancel-button"
        >
          Reset
        </Button>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
          data-testid="general-save-button"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Changes'
          )}
        </Button>
      </div>
    </div>
  );
}
