//! The gate a chat document's request passes before the relay sees it: the id is a chat
//! document's, the node has a chat, and the caller holds the channel's permission for what they
//! ask (`required_channel_permission`), asked of the channel exactly as its messages ask it
//! (`group_access::authorize_group`).
//!
//! Every way of failing the last two is one refusal, `ChatDocumentDenied`, as `group_access`
//! answers every denial alike: telling "no such node" from "no chat" from "not yours" would
//! say which nodes and channels exist to someone who may see neither.

use super::target::Target;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::group_access::authorize_group;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::chat_documents::{is_chat_document_id, required_channel_permission};
use citadel_workspace_types::documents::{DocumentRefusal, DocumentsRequest};

/// `Ok(Err)` is the refusal to answer with.
pub(super) async fn admit<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    chat_doc: &str,
    request: &DocumentsRequest,
) -> Result<Result<Target, DocumentRefusal>, NetworkError> {
    let node_id = request.node_id();
    if !is_chat_document_id(chat_doc) {
        return Ok(Err(DocumentRefusal::ChatDocumentIdInvalid {
            node_id: node_id.to_string(),
        }));
    }
    let permission = required_channel_permission(request);
    let denied = || DocumentRefusal::ChatDocumentDenied {
        node_id: node_id.to_string(),
        permission,
    };
    let nodes = kernel
        .domain_operations
        .backend_tx_manager
        .get_all_nodes_shared()
        .await?;
    let Some(channel) = nodes
        .get(node_id)
        .filter(|node| node.chat_enabled)
        .and_then(|node| node.chat_channel_id.clone())
    else {
        return Ok(Err(denied()));
    };
    match authorize_group(kernel, actor_user_id, &channel, permission).await {
        Some(owner) if owner == node_id => Ok(Ok(Target::chat(node_id, chat_doc, channel))),
        _ => Ok(Err(denied())),
    }
}
