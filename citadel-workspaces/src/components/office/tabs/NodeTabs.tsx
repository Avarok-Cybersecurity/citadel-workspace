import { useMemo, type ReactNode } from 'react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { NodeChat } from '../NodeChat';
import { chatSelf } from '@/lib/tab-identity';
import type { ChatSelf } from '@/lib/chat/transport/chat-transport';
import { GroupCallControls } from '@/components/call/GroupCallControls';
import type { RoomCallRoster } from '@/lib/call/callable-members';
import { usePermission } from '@/hooks/use-permission';
import { confirms, permits } from '@/hooks/use-permission-result';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { debugLog } from '@/lib/debug-config';
import type { GroupRestriction } from '@/components/chat/group-restriction';
import { Permission } from '@/lib/permissions-service/types';
import { GroupCallDock } from '@/components/call/GroupCallDock';
import { useDomainCallMembers } from '@/hooks/use-domain-call-members';
import { useNodeRoster } from '@/hooks/use-node-roster';
import type { User } from '@/types/workspace-entities';
import { appIdsOf, type NodeTab, type NodeTabKey } from '@/lib/node-tabs/tab-list';
import type { NodeTabsModel } from './use-node-tabs';
import { useAppTabNames, type AppTabName } from './use-app-tab-names';
import { TabRow } from './TabRow';
import { TabMenu } from './TabMenu';
import { TabNotices } from './TabNotices';

interface NodeTabsProps {
  model: NodeTabsModel;
  contentView: ReactNode;
  /** The node's chat channel, which also scopes its group call; null when chat is off. */
  chatChannelId: string | null;
  /** The workspace node whose member roster a call here would ring. */
  nodeId: string;
  roomName: string;
  /** The reader's workspace id: what the server writes as the sender of their messages. */
  currentUserId: string;
  currentUserName: string;
  /** The reader's CID; undefined until the tab knows it. */
  currentUserCid: bigint | undefined;
  /** The channel's rules; null when it has none. */
  rules: string | null;
  /** What an app tab's panel shows (app-zone/AppTabPane.tsx). */
  appPanel: (appId: string, name: AppTabName) => ReactNode;
  /** Opens the marketplace to add a tab; null when this person may not add one. */
  onAdd: (() => void) | null;
}

/**
 * A node's pane as tabs: its page, its chat when chat is on, and its app tabs, plus the calling
 * surface. The call docks ABOVE the tabs: inactive tab panels unmount, and a call that goes silent
 * whenever the user glances at another tab reads as dropped.
 */
export function NodeTabs({
  model,
  contentView,
  chatChannelId,
  nodeId,
  roomName,
  currentUserId,
  currentUserName,
  currentUserCid,
  rules,
  appPanel,
  onAdd,
}: NodeTabsProps): JSX.Element {
  // Keyed by its parts: a new object every render would rebuild the chat's transport.
  const self: ChatSelf | null = useMemo(
    (): ChatSelf | null => chatSelf({ id: currentUserId, displayName: currentUserName }, currentUserCid),
    [currentUserId, currentUserName, currentUserCid],
  );
  // One roster for the node: the call rings it, and the chat counts receipts and members against it.
  const members: readonly User[] | null = useNodeRoster(nodeId);
  const callRoster: RoomCallRoster = useDomainCallMembers(members);
  const names: ReadonlyMap<string, AppTabName> = useAppTabNames(appIdsOf(model.list));
  // Office chat is governed by the workspace permission system, not by group
  // roles, so its only two answers are the permission's.
  const send: ReturnType<typeof usePermission> = usePermission(nodeId, Permission.SendMessages);
  // Who may buy chat-document packs, as the share panel decides who may buy link packs.
  const managesSubscription: boolean = confirms(usePermission(WORKSPACE_ROOT_ID, Permission.ManageRoles));

  // `permits`, not `allowed`: four states are not the answer "no", and this
  // site had three of them. See hooks/use-permission-result.ts.
  const sendRestriction: GroupRestriction = permits(send) ? 'allowed' : 'denied-by-role';

  // A refusal here removes the composer, and CI has now shown one happening to
  // a user who should have been able to send. `permits` is false only when an
  // answer arrived AND withheld the permission, so the useful thing to know is
  // what that answer said -- the role it came with, and which domain it was
  // about, since `hasPermission` falls back to the workspace root.
  //
  // Logged rather than shown: the reader is told "you do not have permission",
  // which is the truthful sentence for them; the role and the domain are for
  // whoever is reading a failing run.
  if (chatChannelId !== null && sendRestriction === 'denied-by-role') {
    // Tagged as before the tabs were generalised: the integration suite's console capture keys on it.
    debugLog(
      'OfficeChatTabs',
      'composer withheld',
      {
        nodeId,
        allowed: send.allowed,
        answered: send.answered,
        loading: send.loading,
        unanswered: send.unanswered,
      },
    );
  }

  const panel = (tab: NodeTab): ReactNode => {
    if (tab.kind === 'content') return contentView;
    if (tab.kind === 'chat') {
      return chatChannelId === null ? null : (
        <NodeChat nodeId={nodeId} channelId={chatChannelId} channelName={roomName} self={self} sendRestriction={sendRestriction} rules={rules} members={members} managesSubscription={managesSubscription} />
      );
    }
    return appPanel(tab.appId, names.get(tab.appId) ?? { label: tab.appId, known: false });
  };

  return (
    <div className="w-full min-w-0 h-full flex flex-col">
      {chatChannelId !== null && <GroupCallDock roomId={chatChannelId} />}
      <Tabs
        // Controlled, and seeded from what this node was last left on (lib/node-tabs/tab-memory).
        // BaseOffice is keyed on the node id so that it remounts, and a selection kept in the
        // component instance threw a reader back to the page mid-conversation.
        value={model.active}
        onValueChange={(next: string): void => {
          const chosen: NodeTab | undefined = model.list.tabs.find((tab: NodeTab): boolean => tab.key === next);
          if (chosen !== undefined) model.select(chosen.key as NodeTabKey);
        }}
        className="w-full flex-1 min-h-0 flex flex-col"
      >
        <TabRow
          tabs={model.list.tabs}
          names={names}
          menu={<TabMenu model={model} names={names} />}
          onAdd={onAdd}
          trailing={chatChannelId === null ? null : (
            <div className="flex flex-shrink-0 items-center">
              <GroupCallControls
                home={{ kind: 'node', roomId: chatChannelId, nodeId }}
                roomName={roomName}
                members={callRoster.callable}
                notConnected={callRoster.notConnected}
              />
            </div>
          )}
        />
        <TabNotices model={model} />
        {model.list.tabs.map((tab: NodeTab): JSX.Element => (
          <TabsContent
            key={tab.key}
            value={tab.key}
            className={tab.kind === 'content' ? 'mt-0 flex-1 overflow-auto' : tab.kind === 'chat' ? 'mt-0 flex-1 overflow-hidden' : 'mt-0 flex-1 min-h-0 overflow-hidden flex flex-col'}
          >
            {panel(tab)}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
