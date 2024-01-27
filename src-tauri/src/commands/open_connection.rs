use crate::structs::{ConnectionState, Payload};
use citadel_internal_service_connector::util::InternalServiceConnector;
use citadel_internal_service_types::InternalServiceResponse;
use citadel_logging::error;
use futures::StreamExt;
use std::error::Error;
use tauri::{Manager, State};

fn send_response(
    packet_name: &str,
    packet: InternalServiceResponse,
    window: &tauri::Window,
) -> Result<(), Box<dyn Error>> {
    let error = packet.is_error();

    let payload = Payload { packet, error };

    let _ = window.emit(packet_name, serde_json::to_string(&payload)?);
    Ok(())
}

#[tauri::command]
pub async fn open_connection(
    state: State<'_, ConnectionState>,
    window: tauri::Window,
    addr: String,
) -> Result<(), String> {
    let mut state_modifier_sink = &state.sink;
    let mut state_modifier_stream = &state.stream;
    let connector = InternalServiceConnector::connect(addr).await.unwrap();
    let (sink, mut stream) = connector.split();
    let conn_state = ConnectionState::new(&sink, &stream);
    state_modifier_sink = &conn_state.sink;
    state_modifier_stream = &conn_state.stream;
    let service_to_gui = async move {
        while let Some(packet) = stream.next().await {
            if let Err(e) = send_response("packet_stream", packet, &window) {
                error!(e)
            }
        }
    };
    tauri::async_runtime::spawn(service_to_gui);
    Ok(())
}
