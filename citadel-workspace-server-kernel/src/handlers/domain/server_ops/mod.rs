use citadel_sdk::prelude::Ratchet;
use parking_lot::RwLock;
use std::sync::Arc;

use crate::kernel::transaction::TransactionManager;

// Import submodules
pub mod base_operations;
pub mod permission_operations;
pub mod domain_entity_operations;
pub mod workspace_member_operations;
pub mod workspace_crud_operations;
pub mod office_operations;
mod room_operations;
mod user_operations;
mod workspace_operations;

// Re-export needed types and functions

/// Server-side implementation of domain operations
#[derive(Clone)]
pub struct DomainServerOperations<R: Ratchet + Send + Sync + 'static> {
    pub(crate) tx_manager: Arc<RwLock<TransactionManager>>,
    _ratchet: std::marker::PhantomData<R>,
}

impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    /// Create a new instance of DomainServerOperations
    pub fn new(kernel: Arc<RwLock<TransactionManager>>) -> Self {
        Self {
            tx_manager: kernel,
            _ratchet: std::marker::PhantomData,
        }
    }
}
