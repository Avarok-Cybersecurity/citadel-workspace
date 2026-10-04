//! The proof client's node kernel: hands the node's remote out and holds the node open until
//! told to stop (session.rs drives it).

use citadel_sdk::prelude::*;
use futures::channel::oneshot;

type Slot<T> = citadel_io::Mutex<Option<T>>;

/// Hands the node's remote out and holds the node open until told to stop.
pub(crate) struct SessionKernel {
    pub(crate) remote_tx: Slot<oneshot::Sender<NodeRemote<StackedRatchet>>>,
    pub(crate) stop_rx: Slot<oneshot::Receiver<()>>,
}

#[async_trait]
impl NetKernel<StackedRatchet> for SessionKernel {
    fn load_remote(&mut self, remote: NodeRemote<StackedRatchet>) -> Result<(), NetworkError> {
        let tx = self.remote_tx.lock().take();
        let tx = tx.ok_or_else(|| NetworkError::msg("remote loaded twice"))?;
        tx.send(remote)
            .map_err(|_| NetworkError::msg("the client went away before its node started"))
    }

    async fn on_start(&self) -> Result<(), NetworkError> {
        let stop = self.stop_rx.lock().take();
        if let Some(stop) = stop {
            let _ = stop.await;
        }
        Ok(())
    }

    async fn on_node_event_received(
        &self,
        _message: NodeResult<StackedRatchet>,
    ) -> Result<(), NetworkError> {
        Ok(())
    }

    async fn on_stop(&mut self) -> Result<(), NetworkError> {
        Ok(())
    }
}
