use crate::state::WorkspaceState;
use citadel_workspace_types::WorkspaceProtocolRequest;
use std::error::Error;

pub async fn handle(
    request: WorkspaceProtocolRequest,
    state: &WorkspaceState,
) -> Result<(), Box<dyn Error>> {
    // TODO: Fill in all possibilities, update all possible handlers, update tauri window ui
    // Tauri UI can be updated via state.window.get().emit(), and will need to have typescript-generated event handlers
    // match request {}
    todo!()
}
