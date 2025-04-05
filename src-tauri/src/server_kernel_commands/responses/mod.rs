use crate::state::WorkspaceState;
use citadel_workspace_types::WorkspaceProtocolResponse;
use std::error::Error;

pub async fn handle(
    response: WorkspaceProtocolResponse,
    state: &WorkspaceState,
) -> Result<(), Box<dyn Error>> {
    // TODO: Fill in all possibilities, update all possible handlers, update tauri window ui
    // Tauri UI can be updated via state.window.get().emit(), and will need to have corresponding typescript-generated event handlers
    // match response {}
    todo!()
}
