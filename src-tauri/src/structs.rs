use std::collections::HashMap;
use std::sync::Arc;

use citadel_internal_service_connector::messenger::MessengerTx;
use citadel_internal_service_connector::messenger::{
    backend::CitadelWorkspaceBackend, CitadelWorkspaceMessenger,
};
use citadel_internal_service_types::InternalServiceResponse;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::RwLock;
use uuid::Uuid;

pub struct PacketHandle {
    pub channel: UnboundedSender<InternalServiceResponse>, // The channel to stream the response to
}

pub struct ConnectionRouterState {
    pub messenger_mux: CitadelWorkspaceMessenger<CitadelWorkspaceBackend>,
    pub to_subscribers: Arc<RwLock<HashMap<Uuid, PacketHandle>>>,
    pub default_mux: MessengerTx<CitadelWorkspaceBackend>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Payload {
    pub packet: InternalServiceResponse,
    pub error: bool,
    pub notification: bool,
}
