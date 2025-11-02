//! # Async Domain Operations Module
//!
//! This module provides async versions of all domain operations traits
//! for use with the BackendTransactionManager.

use async_trait::async_trait;
use citadel_sdk::prelude::Ratchet;

pub mod async_domain_ops;
pub mod async_entity_ops;
pub mod async_office_ops;
pub mod async_permission_ops;
pub mod async_room_ops;
pub mod async_transaction_ops;
pub mod async_user_ops;
pub mod async_workspace_ops;

// Re-export all async traits
pub use async_domain_ops::AsyncDomainOperations;
pub use async_entity_ops::AsyncEntityOperations;
pub use async_office_ops::AsyncOfficeOperations;
pub use async_permission_ops::AsyncPermissionOperations;
pub use async_room_ops::AsyncRoomOperations;
pub use async_transaction_ops::AsyncTransactionOperations;
pub use async_user_ops::AsyncUserManagementOperations;
pub use async_workspace_ops::AsyncWorkspaceOperations;

/// Unified async trait that combines all domain operation categories.
#[async_trait]
#[auto_impl::auto_impl(Arc)]
pub trait AsyncCompleteDomainOperations<R: Ratchet + Send + Sync + 'static>:
    AsyncDomainOperations<R>
    + AsyncTransactionOperations<R>
    + AsyncPermissionOperations<R>
    + AsyncUserManagementOperations<R>
    + AsyncEntityOperations<R>
    + AsyncWorkspaceOperations<R>
    + AsyncOfficeOperations<R>
    + AsyncRoomOperations<R>
    + Send
    + Sync
{
    // This trait automatically combines all operation categories
}
