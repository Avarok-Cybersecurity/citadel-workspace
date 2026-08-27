//! Group chat had no authorization of any kind.
//!
//! `SendGroupMessage`, `GetGroupMessages`, `GetThreadMessages`,
//! `EditGroupMessage` and `DeleteGroupMessage` all took `group_id` straight
//! from the request and used it. Any authenticated account could read a
//! channel's whole history, post into it, and store messages under a
//! `group_id` that belonged to no node at all — including channels whose node
//! had been deleted. The rest of the tree has been gated per node since
//! `update_node` learned to check `check_entity_permission` against its target;
//! chat simply never adopted the rule.
//!
//! The gate is `Permission::ViewContent` on the node owning the channel — the
//! same rule that governs reading that node's content, resolved through the
//! same function, so the two cannot drift.

use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::structs::{
    DomainNode, DomainPermissions, NodeEntityType, User, UserRole,
};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::collections::HashMap;

mod common {
    pub use ::common::*;
}

const CHANNEL: &str = "chat-channel-under-test";
const ROOM_ID: &str = "room-under-test";
const MEMBER: &str = "room_member";
const OUTSIDER: &str = "not_in_this_workspace";

type Kernel = AsyncWorkspaceServerKernel<MonoRatchet>;

async fn add_user(kernel: &Kernel, id: &str) {
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(
            id.to_string(),
            User {
                id: id.to_string(),
                name: id.to_string(),
                role: UserRole::Member,
                permissions: HashMap::new(),
                metadata: Default::default(),
            },
        )
        .await
        .expect("insert user");
}

/// A room with chat enabled, whose only member is MEMBER. Written straight to
/// the backend so the test states the shape it depends on rather than
/// inheriting whatever the seeding path happens to produce.
async fn add_room_with_chat(kernel: &Kernel) {
    let node = DomainNode {
        id: ROOM_ID.to_string(),
        parent_id: None,
        entity_type: NodeEntityType::Child("Room".to_string()),
        depth: 1,
        name: "Room".to_string(),
        description: String::new(),
        owner_id: MEMBER.to_string(),
        members: vec![MEMBER.to_string()],
        children: vec![],
        mdx_content: String::new(),
        rules: None,
        chat_enabled: true,
        chat_channel_id: Some(CHANNEL.to_string()),
        default_permissions: DomainPermissions::default(),
        metadata: Default::default(),
        allowed_child_types: None,
        is_default: false,
        created_at: 0,
        updated_at: 0,
    };
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_node(ROOM_ID.to_string(), node)
        .await
        .expect("insert node");
}

fn is_denied(response: &WorkspaceProtocolResponse) -> bool {
    matches!(response, WorkspaceProtocolResponse::Error(e) if e.contains("Permission denied"))
}

fn read(group_id: &str) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::GetGroupMessages {
        group_id: group_id.to_string(),
        before_timestamp: None,
        limit: None,
    }
}

fn post(group_id: &str) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::SendGroupMessage {
        group_id: group_id.to_string(),
        message_type: citadel_workspace_types::GroupMessageType::Text,
        content: "hello".to_string(),
        reply_to: None,
        mentions: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_outsider_cannot_read_a_channel() {
    let kernel = create_test_kernel().await;
    add_user(&kernel, MEMBER).await;
    add_user(&kernel, OUTSIDER).await;
    add_room_with_chat(&kernel).await;

    let response = process_command_with_user(&kernel, &read(CHANNEL), OUTSIDER)
        .await
        .expect("dispatch");

    assert!(
        is_denied(&response),
        "naming the channel id was enough to read the whole history; got {response:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_outsider_cannot_post_into_a_channel() {
    let kernel = create_test_kernel().await;
    add_user(&kernel, MEMBER).await;
    add_user(&kernel, OUTSIDER).await;
    add_room_with_chat(&kernel).await;

    let response = process_command_with_user(&kernel, &post(CHANNEL), OUTSIDER)
        .await
        .expect("dispatch");

    assert!(
        is_denied(&response),
        "an outsider could post into any room by id; got {response:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_can_still_read_and_post() {
    let kernel = create_test_kernel().await;
    add_user(&kernel, MEMBER).await;
    add_room_with_chat(&kernel).await;

    let posted = process_command_with_user(&kernel, &post(CHANNEL), MEMBER)
        .await
        .expect("dispatch");
    assert!(
        matches!(
            posted,
            WorkspaceProtocolResponse::GroupMessageNotification { .. }
        ),
        "the gate must not lock out the people the channel is for; got {posted:?}"
    );

    let history = process_command_with_user(&kernel, &read(CHANNEL), MEMBER)
        .await
        .expect("dispatch");
    match history {
        WorkspaceProtocolResponse::GroupMessages { messages, .. } => {
            assert_eq!(messages.len(), 1, "the member's own message must come back");
        }
        other => panic!("expected the history, got {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_channel_belonging_to_no_node_is_denied_even_to_an_admin() {
    let kernel = create_test_kernel().await;

    let response =
        process_command_with_user(&kernel, &post("channel-nobody-owns"), TEST_ADMIN_USER_ID)
            .await
            .expect("dispatch");

    // An unowned channel is not an empty room, it is a name with no room behind
    // it. Storing under it gave every account a private, unbounded, unowned
    // message store inside the workspace's own backend — and re-opened the
    // history of any node that had since been deleted.
    assert!(
        is_denied(&response),
        "an admin bypasses permission checks, but there is no node here to be \
         permitted on; got {response:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn denial_does_not_reveal_whether_the_channel_exists() {
    let kernel = create_test_kernel().await;
    add_user(&kernel, MEMBER).await;
    add_user(&kernel, OUTSIDER).await;
    add_room_with_chat(&kernel).await;

    let real = process_command_with_user(&kernel, &read(CHANNEL), OUTSIDER)
        .await
        .expect("dispatch");
    let fake = process_command_with_user(&kernel, &read("no-such-channel"), OUTSIDER)
        .await
        .expect("dispatch");

    assert_eq!(
        format!("{real:?}"),
        format!("{fake:?}"),
        "distinguishing the two makes the handler an oracle for which rooms exist"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_message_is_broadcast_to_the_channel_not_the_whole_server() {
    use citadel_workspace_server_kernel::kernel::async_kernel::BroadcastAudience;

    let kernel = create_test_kernel().await;
    add_user(&kernel, MEMBER).await;
    add_room_with_chat(&kernel).await;
    let mut rx = kernel.subscribe_broadcast();

    process_command_with_user(&kernel, &post(CHANNEL), MEMBER)
        .await
        .expect("dispatch");

    let msg = rx.try_recv().expect("the message must be broadcast");
    // Everyone means every connected session, whatever rooms they are in. The
    // per-connection forwarding loop is the only place that knows which user a
    // socket belongs to, so the audience has to travel with the message for the
    // check to be possible at all.
    assert_eq!(
        msg.audience,
        BroadcastAudience::Group(CHANNEL.to_string()),
        "a room message addressed to Everyone reaches sessions that cannot open the room"
    );
}

/// Documents current behaviour rather than endorsing it.
///
/// `is_member_of_domain` recurses to the parent, so membership of the workspace
/// root grants `ViewContent` on every node beneath it — and every account is
/// added to the workspace domain when it connects. The seeded offices are
/// created with an empty `members` list and rely on exactly that inheritance,
/// so a gate that demanded direct node membership would lock every user out of
/// the chat in every seeded office.
///
/// The consequence is that the gate above stops accounts outside the workspace
/// and channels belonging to no node — it does NOT make one room's chat private
/// from another room's occupants. Making it private is a membership-model
/// change, not a check: see docs/ROBUSTNESS.md.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn membership_of_the_parent_still_grants_the_childs_chat() {
    let kernel = create_test_kernel().await;
    add_user(&kernel, MEMBER).await;
    add_user(&kernel, OUTSIDER).await;

    // Same room as the other tests, but parented to a node OUTSIDER belongs to.
    let parent_id = "parent-office";
    let parent = DomainNode {
        id: parent_id.to_string(),
        parent_id: None,
        entity_type: NodeEntityType::Child("Office".to_string()),
        depth: 1,
        name: "Office".to_string(),
        description: String::new(),
        owner_id: OUTSIDER.to_string(),
        members: vec![OUTSIDER.to_string()],
        children: vec![ROOM_ID.to_string()],
        mdx_content: String::new(),
        rules: None,
        chat_enabled: false,
        chat_channel_id: None,
        default_permissions: DomainPermissions::default(),
        metadata: Default::default(),
        allowed_child_types: None,
        is_default: false,
        created_at: 0,
        updated_at: 0,
    };
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_node(parent_id.to_string(), parent)
        .await
        .expect("insert parent");
    add_room_with_chat(&kernel).await;
    let mut room = kernel
        .domain_operations
        .backend_tx_manager
        .get_node(ROOM_ID)
        .await
        .expect("get node")
        .expect("room exists");
    room.parent_id = Some(parent_id.to_string());
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_node(ROOM_ID.to_string(), room)
        .await
        .expect("reparent");

    let response = process_command_with_user(&kernel, &read(CHANNEL), OUTSIDER)
        .await
        .expect("dispatch");

    assert!(
        !is_denied(&response),
        "if this ever starts denying, room membership stopped inheriting and the \
         seeded offices' chat just went dark for everyone: got {response:?}"
    );
}
