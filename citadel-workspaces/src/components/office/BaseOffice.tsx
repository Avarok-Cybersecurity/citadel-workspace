import { useState, useEffect, useCallback } from "react";
import { readerIdentity, type ReaderIdentity, type TabIdentity } from '@/lib/tab-identity';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import { useChatSurface, type ChatSurface } from './chat-surface';
import { useToast } from "@/hooks/use-toast";
import { MDXProvider } from '@mdx-js/react';
import { components } from "./mdxComponents";
import { OfficeLayout } from "./OfficeLayout";
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { OfficeSkeletonLoader } from "../ui/skeleton-office";
import { OfficeEditorPane } from "./OfficeEditorPane";
import { joinHeader, splitHeader } from "@/lib/citadel-apps/md-header";
import { templateCategoryFor, type MdxTemplate, type TemplateCategory } from "@/lib/mdx-templates";
import type { NodeEntityType } from "@/lib/entity-type-registry";
import { saveOfficeContent } from "./save-office-content";
import { useCompiledMdx } from "./use-compiled-mdx";
import { useApplyTemplate } from "./use-apply-template";
import { DocumentRenderError } from "./DocumentRenderError";
import { useUnsavedMdxGuard, DISCARD_EDIT_PROMPT } from "./use-unsaved-mdx-guard";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { editGate, noPageReason } from "./edit-gate";
import type { ActionGate } from '@/hooks/use-permission-result';
import WorkspaceService from "@/lib/workspace-service";
import { NodePane } from "./tabs/NodePane";
import { usePermission } from '@/hooks/use-permission';
import { Permission } from "@/contexts/PermissionsContext";
import { debugLog } from '@/lib/debug-config';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

interface BaseOfficeProps {
  title: string;
  getInitialContent: () => string;
  nodeId?: string;
}

export const BaseOffice = ({ title, getInitialContent, nodeId }: BaseOfficeProps): JSX.Element => {
  const { state } = useWorkspace();

  // Get the entity data from workspace state (unified node hierarchy)
  const entityData: DomainNode | null = nodeId ? state.nodes[nodeId] : null;

  // Initialize content from mdx_content if available, otherwise use getInitialContent
  const [content, setContent] = useState<string>(
    entityData?.mdx_content || getInitialContent()
  );
  const [isEditing, setIsEditing] = useState(false);

  const [isNewContent, setIsNewContent] = useState(!entityData?.mdx_content);
  const { toast } = useToast();
  // Selection first, saved account second — see `tabIdentity`.
  const tabSession: TabIdentity | null = useTabIdentity();

  // Determine if we're in a loading state
  const isLoading: boolean = state.loading.nodes && !entityData;

  const { compiled: compiledContent, renderError } = useCompiledMdx(
    content,
    components,
    // Only the STORED document is verified. While the user is editing, `content`
    // is their unsaved buffer and will not match any hash — refusing to render
    // their own typing would be absurd.
    isEditing || isNewContent ? undefined : entityData?.mdx_content_hash,
    isEditing,
  );

  // "No node" is the workspace ROOT, a real permission domain -- the same
  // fallback the unsaved guard below and OfficeChatTabs already use. The check
  // read `!domainId || permits(...)`, so a missing domain skipped it entirely
  // and offered the action. See docs/ROBUSTNESS.md round 693.
  const domainId: string = nodeId ?? WORKSPACE_ROOT_ID;

  // Check if user can edit the MDX content using the permissions system
  const edit: ReturnType<typeof usePermission> = usePermission(
    domainId,
    Permission.EditMdx
  );

  const { isDirty } = useUnsavedMdxGuard({ isEditing, content, ownerId: nodeId ?? WORKSPACE_ROOT_ID });
  const confirm: ReturnType<typeof useConfirm> = useConfirm();

  // Cancel used to be a bare toggle. The load effect below then restored the
  // stored document over the buffer, so the edits were gone with no prompt.
  const handleEditToggle = async (): Promise<void> => {
    if (isEditing && isDirty && !(await confirm(DISCARD_EDIT_PROMPT))) return;
    setIsEditing(!isEditing);
  };

  const handleSave = async (): Promise<void> => {
    // The decision lives in saveOfficeContent so it can be tested without
    // rendering the MDX pipeline; this supplies the I/O and reacts to the answer.
    const saved: boolean = await saveOfficeContent({
      nodeId,
      content,
      displayName: entityData?.name || title,
      noPageReason: noPageReason(state.loading.nodes),
      write: (id, mdxContent) => WorkspaceService.updateNode(id, { mdxContent }),
      notify: ({ kind, title: noticeTitle, description }) =>
        toast({
          title: noticeTitle,
          description,
          variant: kind === 'success' ? 'success' : 'destructive',
        }),
      log: (message, error) => debugLog('BaseOffice', message, error),
    });

    // Only on a confirmed write: anything else and the user's text exists
    // nowhere but this editor.
    if (saved) setIsEditing(false);
  };

  // Load the document into the buffer — but NEVER while the user is editing it.
  //
  // `content` is the controlled value of the textarea, so every run of this
  // effect replaced whatever was being typed and destroyed the native undo
  // stack with it. It fired far more often than "when entity data changes":
  // `getInitialContent` was a new function identity on every render of
  // WorkspaceView, which subscribes to the whole workspace store — so a
  // colleague's typing indicator or an incoming message elsewhere in the app
  // wiped the open editor. On a brand-new node the else branch ran and replaced
  // the user's work with the default template.
  //
  // A remote save is the deterministic case: it mints a new node object, and
  // the author's paragraph became the other person's. Not overwriting is the
  // safe half of that; telling the user their view is now stale is recorded in
  // docs/ROBUSTNESS.md as the other half.
  useEffect(() => {
    if (isEditing) return;
    if (entityData?.mdx_content) {
      setContent(entityData.mdx_content);
      setIsNewContent(false);
    } else {
      setContent(getInitialContent());
      setIsNewContent(true);
    }
  }, [entityData, getInitialContent, isEditing]);


  const level: NodeEntityType = entityData?.entity_type ?? 'Workspace';
  const templateCategory: TemplateCategory | null = templateCategoryFor(level, state.treeSchema);
  // A template replaces the body; a required-apps header on the first line stays (md-header.ts).
  const keepHeader: (body: string) => void = useCallback((body: string): void => setContent((prev: string) => joinHeader(splitHeader(prev).header, body)), []);
  const handleTemplateSelect: (template: MdxTemplate) => void = useApplyTemplate(components, keepHeader, (): void => setIsNewContent(false));

  // Show skeleton loader during loading state
  // Chat is enabled, disabled, or NOT YET ANSWERED -- see chat-surface.ts.
  // `entityData?.chat_enabled ?? false` read the third as the second, so a node
  // momentarily absent from `state.nodes` took the whole tab surface down and
  // the composer with it.
  const chat: ChatSurface | null = useChatSurface(nodeId, entityData);

  if (isLoading) {
    return <OfficeSkeletonLoader />;
  }

  // Enabled on a known yes only; see edit-gate.ts for why "not answered" is not yes here.
  const gate: ActionGate = editGate(nodeId, state.loading.nodes, edit);

  // Get current user info from workspace state OR connection manager
  // State first, tab identity second — see `readerIdentity`.
  const reader: ReaderIdentity = readerIdentity(state.currentUser, tabSession);

  // Content view (MDX editor or rendered content)
  const contentView: JSX.Element = isEditing ? (
    <OfficeEditorPane content={content} setContent={setContent} isNewContent={isNewContent} templateCategory={templateCategory} level={level} onSelectTemplate={handleTemplateSelect} />
  ) : (
    // dark:prose-invert, not prose-invert. The modifier inverts Typography's
    // colours FOR a dark background, so applying it unconditionally made every
    // heading and every bold run light-on-light in light mode: a workspace
    // document showed its body copy and its emoji, and nothing else.
    <div className="px-6 lg:px-10 pt-8 pb-4 prose dark:prose-invert prose-sm md:prose-base lg:prose-lg max-w-4xl">
      <MDXProvider components={components}>
        {/* App zones on this page share NodePane's zone environment; the sandbox host loads with the first that runs an app. */}
        {compiledContent ?? (renderError && (
          // Only when there is nothing to show; outside the editor a failed
          // compile clears the render (use-compiled-mdx), so this is reached.
          <DocumentRenderError
            message={renderError}
            storedHash={entityData?.mdx_content_hash}
            canEdit={gate.enabled}
            onReplace={(template: MdxTemplate): void => { setIsEditing(true); handleTemplateSelect(template); }}
          />
        ))}
      </MDXProvider>
    </div>
  );

  return (
    <OfficeLayout
      title={entityData?.name || title}
      nodeId={nodeId ?? null}
      isEditing={isEditing}
      onEditToggle={() => { void handleEditToggle(); }}
      onSave={handleSave}
      canEdit={gate.enabled}
      editDeniedReason={gate.reason ?? undefined}
    >
      {/* Its tabs when it has any (tabs/NodePane.tsx); the page's zones share their environment. */}
      <NodePane
        nodeId={domainId}
        node={entityData}
        chat={chat}
        contentView={contentView}
        roomName={entityData?.name || title}
        reader={reader}
        readerCid={tabSession?.cid}
      />
    </OfficeLayout>
  );
};
