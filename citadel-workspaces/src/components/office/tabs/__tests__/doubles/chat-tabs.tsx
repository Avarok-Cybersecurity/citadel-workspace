/**
 * TEST DOUBLE: a node pane with chat on and no app tabs, its model built by the real
 * `useNodeTabs` from the metadata given. The writer refuses: these tests are about which tab
 * is open, and a write reaching it would be a test that changed something it did not mean to.
 */
import type { ReactNode } from 'react';
import { NodeTabs } from '../../NodeTabs';
import { useNodeTabs, type NodeTabsModel, type NodeTabsWriter } from '../../use-node-tabs';

const REFUSING_WRITER: NodeTabsWriter = {
  writeNodeTabs: (): Promise<void> => Promise.reject(new Error('this test writes no tabs')),
  setDefaultAppTabs: (): Promise<void> => Promise.reject(new Error('this test writes no tabs')),
};

/** A workspace whose default is "no app tabs": chosen, so no notice is drawn. */
const NO_DEFAULT_APP_TABS: Record<string, unknown> = { default_app_tabs: [] };

export function ChatTabs({ nodeId, chatChannelId, contentView }: { nodeId: string; chatChannelId: string; contentView?: ReactNode }): JSX.Element {
  const model: NodeTabsModel = useNodeTabs({
    nodeId,
    chatEnabled: true,
    nodeMetadata: undefined,
    workspaceMetadata: NO_DEFAULT_APP_TABS,
    writer: REFUSING_WRITER,
  });
  return (
    <NodeTabs
      model={model}
      contentView={contentView ?? <div data-testid="the-document" />}
      chatChannelId={chatChannelId}
      nodeId={nodeId}
      roomName="Random"
      currentUserId="1"
      currentUserName="alice"
      currentUserCid={1n}
      rules={null}
      appPanel={(): null => null}
      onAdd={null}
    />
  );
}
