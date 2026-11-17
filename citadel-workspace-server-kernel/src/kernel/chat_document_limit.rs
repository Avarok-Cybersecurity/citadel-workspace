//! How many documents shared in chats the whole workspace may hold, and who says.
//!
//! The kernel does not know the workspace's plan; the host does. A hosted tenant's Durable Object
//! answers from its stored entitlements (`chat_documents`: the tier's count plus 5000 per pack),
//! a native server from its `kernel.toml` (`chat_documents_limit`, required). A kernel built with
//! none makes no new chat document: there is no default limit. The count is every node's, kept
//! as one workspace counter beside the per-node lists (`transaction::chat_documents_store`).

pub use crate::kernel::limit::Limit;
use std::sync::Arc;

/// The host could not say, and why. The detail is the host's to log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatDocumentLimitUnavailable(pub String);

/// The host capability that knows the workspace's chat-document limit. Asked on each new
/// document, so a plan change applies at once.
pub trait ChatDocumentLimitSource: Send + Sync {
    fn limit(&self) -> Result<Limit, ChatDocumentLimitUnavailable>;
}

/// The capability as the kernel holds it: absent unless the host passed one.
pub type ChatDocumentLimitSourceHandle = Option<Arc<dyn ChatDocumentLimitSource>>;

/// A limit fixed when the server starts: a native server's, read from `kernel.toml`.
pub struct FixedChatDocumentLimit(pub u32);

impl ChatDocumentLimitSource for FixedChatDocumentLimit {
    fn limit(&self) -> Result<Limit, ChatDocumentLimitUnavailable> {
        Ok(Limit::At(self.0))
    }
}

/// The limit that is reached, when the workspace holding `held` cannot take one more.
pub fn full_at(limit: Limit, held: u64) -> Option<u32> {
    match limit {
        Limit::At(max) if held >= u64::from(max) => Some(max),
        _ => None,
    }
}
