//! Whether a node has chat, and the channel its messages are held under.
//!
//! One rule for both paths that set it -- creating a node and updating one -- so "chat on" always
//! means the same thing: the flag, AND a channel to talk in. `create_node` used to hard-code chat
//! off with no channel, so every new office opened without a Chat tab.

use citadel_workspace_types::structs::DomainNode;

/// Chat state for a newly created child node. On, until the hierarchy editor gives each level
/// type its own default.
pub(crate) const NEW_NODE_CHAT_ENABLED: bool = true;

/// Switch a node's chat on or off. Switching on mints its channel the first time; switching off
/// keeps the channel, because the node's history is stored under it and comes back with chat.
pub(crate) fn set_chat_enabled(node: &mut DomainNode, enabled: bool) {
    node.chat_enabled = enabled;
    if enabled && node.chat_channel_id.is_none() {
        node.chat_channel_id = Some(uuid::Uuid::new_v4().to_string());
    }
}
