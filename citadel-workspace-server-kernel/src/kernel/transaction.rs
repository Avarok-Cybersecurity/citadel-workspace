use crate::handlers::transaction::{ReadTransaction, Transaction, WriteTransaction};
use crate::kernel::WorkspaceServerKernel;
use citadel_sdk::prelude::{NetworkError, Ratchet};

impl<R: Ratchet> WorkspaceServerKernel<R> {
    pub fn begin_read_transaction(&self) -> Result<ReadTransaction, NetworkError> {
        Ok(ReadTransaction::new(self.domains.read()))
    }

    pub fn begin_write_transaction(&self) -> Result<WriteTransaction, NetworkError> {
        Ok(WriteTransaction::new(self.domains.write()))
    }

    pub fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        let tx = self.begin_read_transaction()?;
        f(&tx)
    }

    pub fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        let mut tx = self.begin_write_transaction()?;
        match f(&mut tx) {
            Ok(result) => {
                tx.commit()?;
                Ok(result)
            }
            Err(e) => {
                // Automatically roll back on error
                tx.rollback();
                Err(e)
            }
        }
    }
}
