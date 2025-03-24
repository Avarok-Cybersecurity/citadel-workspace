use crate::kernel::WorkspaceServerKernel;
use citadel_sdk::prelude::{NetworkError, Ratchet};

impl<R: Ratchet> WorkspaceServerKernel<R> {
    // Deprecated methods redirecting to the transaction manager implementations
    pub fn begin_read_transaction(
        &self,
    ) -> Result<impl crate::handlers::transaction::Transaction + '_, NetworkError> {
        Ok(self.transaction_manager.read_transaction())
    }

    pub fn begin_write_transaction(
        &self,
    ) -> Result<impl crate::handlers::transaction::Transaction + '_, NetworkError> {
        Ok(self.transaction_manager.write_transaction())
    }
}
