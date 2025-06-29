use crate::handlers::domain::functions::office::office_ops;
use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::DomainOperations;
use crate::kernel::transaction::Transaction;
use crate::kernel::transaction::TransactionManagerExt;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, Office, Permission, Room};
use uuid::Uuid;

#[allow(dead_code)]
impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    /// Create a new office within a workspace (internal implementation)
    pub(crate) fn create_office_internal(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, workspace_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to create office in workspace '{}'",
                    user_id, workspace_id
                )));
            }

            let office_id = uuid::Uuid::new_v4().to_string();
            let mdx_content_string = mdx_content.map(|s| s.to_string());
            let office = office_ops::create_office_inner(
                tx,
                user_id,
                workspace_id,
                &office_id,
                name,
                description,
                mdx_content_string,
            )?;

            Ok(office)
        })
    }

    /// Get office by ID (internal implementation)
    pub(crate) fn get_office_internal(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<String, NetworkError> {
        self.get_office(user_id, office_id)
    }

    /// Update office details (internal implementation)
    pub(crate) fn update_office_internal(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, office_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update office '{}'",
                    user_id, office_id
                )));
            }

            let name_option = name.map(|s| s.to_string());
            let desc_option = description.map(|s| s.to_string());
            let mdx_option = mdx_content.map(|s| s.to_string());
            office_ops::update_office_inner(
                tx,
                user_id,
                office_id,
                name_option,
                desc_option,
                mdx_option,
            )
        })
    }

    /// Delete an office (internal implementation)
    pub(crate) fn delete_office_internal(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, office_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete office '{}'",
                    user_id, office_id
                )));
            }

            office_ops::delete_office_inner(tx, user_id, office_id)
        })
    }

    /// List offices, optionally filtering by workspace (internal implementation)
    pub(crate) fn list_offices_internal(
        &self,
        user_id: &str,
        workspace_id_opt: Option<String>,
    ) -> Result<Vec<Office>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            if let Some(workspace_id) = &workspace_id_opt {
                if !self.check_entity_permission(
                    tx,
                    user_id,
                    workspace_id,
                    Permission::ViewContent,
                )? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to list offices in workspace '{}'",
                        user_id, workspace_id
                    )));
                }
            }

            let workspace_id_string = workspace_id_opt.map(|s| s.to_string());
            office_ops::list_offices_inner(tx, user_id, workspace_id_string)
        })
    }

    /// List offices within a specific workspace (internal implementation)
    pub(crate) fn list_offices_in_workspace_internal(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError> {
        self.list_offices_internal(user_id, Some(workspace_id.to_string()))
    }

    /// List members of a specific office (internal implementation)
    pub(crate) fn list_office_members_internal(
        &self,
        office_id: &str,
    ) -> Result<Vec<(String, String)>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            if let Some(Domain::Office { office }) = tx.get_domain(office_id) {
                Ok(office
                    .members
                    .clone()
                    .into_iter()
                    .map(|id| (id.clone(), id))
                    .collect())
            } else {
                Err(NetworkError::msg(format!("Office {} not found", office_id)))
            }
        })
    }

    pub fn create_office_impl(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if user has permission to create offices in this workspace
            if !self.check_entity_permission_impl(tx, user_id, workspace_id, Permission::CreateOffice)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to create offices in workspace '{}'",
                    user_id, workspace_id
                )));
            }

            // Check if the workspace exists
            if tx.get_workspace(workspace_id).is_none() {
                return Err(NetworkError::msg(format!("Workspace '{}' not found", workspace_id)));
            }

            let office_id = Uuid::new_v4().to_string();
            let office = Office {
                id: office_id.clone(),
                name: name.to_string(),
                description: description.to_string(),
                workspace_id: workspace_id.to_string(),
                owner_id: user_id.to_string(),
                members: vec![user_id.to_string()],
                rooms: Vec::new(),
                mdx_content: mdx_content.unwrap_or("").to_string(),
                metadata: Default::default(),
            };

            // Insert the office
            tx.insert_office(office_id.clone(), office.clone())?;

            // Create the corresponding domain
            let domain = citadel_workspace_types::structs::Domain::Office {
                office: office.clone(),
            };
            tx.insert_domain(office_id.clone(), domain)?;

            // Add the creator as a member
            tx.add_user_to_domain(user_id, &office_id, citadel_workspace_types::structs::UserRole::Owner)?;

            // Add the office to the workspace
            if let Some(mut workspace) = tx.get_workspace(workspace_id).cloned() {
                workspace.offices.push(office_id);
                tx.insert_workspace(workspace_id.to_string(), workspace)?;
            }

            Ok(office)
        })
    }

    pub fn get_office_impl(&self, user_id: &str, office_id: &str) -> Result<String, NetworkError> {
        self.with_read_transaction(|tx| {
            // Check if user has permission to view this office
            if !self.check_entity_permission_impl(tx, user_id, office_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to view office '{}'",
                    user_id, office_id
                )));
            }

            if let Some(office) = tx.get_office(office_id) {
                // Return office data as JSON string for compatibility
                Ok(serde_json::to_string(&office).unwrap_or_else(|_| "{}".to_string()))
            } else {
                Err(NetworkError::msg(format!("Office '{}' not found", office_id)))
            }
        })
    }

    pub fn delete_office_impl(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if user has permission to delete this office
            if !self.check_entity_permission_impl(tx, user_id, office_id, Permission::DeleteOffice)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete office '{}'",
                    user_id, office_id
                )));
            }

            // Get the office before deletion
            if let Some(office) = tx.get_office(office_id).cloned() {
                // Remove all rooms in the office first
                for room_id in &office.rooms {
                    tx.remove_room(room_id)?;
                }

                // Remove the office from its workspace
                if let Some(mut workspace) = tx.get_workspace(&office.workspace_id).cloned() {
                    workspace.offices.retain(|id| id != office_id);
                    tx.insert_workspace(office.workspace_id.clone(), workspace)?;
                }

                // Remove the office
                tx.remove_office(office_id)?;

                // Remove the corresponding domain
                tx.remove_domain(office_id)?;

                Ok(office)
            } else {
                Err(NetworkError::msg(format!("Office '{}' not found", office_id)))
            }
        })
    }

    pub fn update_office_impl(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if user has permission to update this office
            if !self.check_entity_permission_impl(tx, user_id, office_id, Permission::UpdateOffice)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update office '{}'",
                    user_id, office_id
                )));
            }

            // Get and update the office
            if let Some(mut office) = tx.get_office(office_id).cloned() {
                if let Some(name) = name {
                    office.name = name.to_string();
                }
                if let Some(description) = description {
                    office.description = description.to_string();
                }
                if let Some(mdx_content) = mdx_content {
                    office.mdx_content = mdx_content.to_string();
                }

                tx.insert_office(office_id.to_string(), office.clone())?;

                // Update the corresponding domain
                let domain = citadel_workspace_types::structs::Domain::Office {
                    office: office.clone(),
                };
                tx.insert_domain(office_id.to_string(), domain)?;

                Ok(office)
            } else {
                Err(NetworkError::msg(format!("Office '{}' not found", office_id)))
            }
        })
    }

    pub fn list_offices_impl(
        &self,
        user_id: &str,
        workspace_id: Option<String>,
    ) -> Result<Vec<Office>, NetworkError> {
        self.with_read_transaction(|tx| {
            tx.list_offices(user_id, workspace_id)
        })
    }

    pub fn create_room_impl(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if user has permission to create rooms in this office
            if !self.check_entity_permission_impl(tx, user_id, office_id, Permission::CreateRoom)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to create rooms in office '{}'",
                    user_id, office_id
                )));
            }

            // Check if the office exists
            if tx.get_office(office_id).is_none() {
                return Err(NetworkError::msg(format!("Office '{}' not found", office_id)));
            }

            let room_id = Uuid::new_v4().to_string();
            let room = Room {
                id: room_id.clone(),
                name: name.to_string(),
                description: description.to_string(),
                office_id: office_id.to_string(),
                owner_id: user_id.to_string(),
                members: vec![user_id.to_string()],
                mdx_content: mdx_content.unwrap_or("").to_string(),
                metadata: Default::default(),
            };

            // Insert the room
            tx.insert_room(room_id.clone(), room.clone())?;

            // Create the corresponding domain
            let domain = citadel_workspace_types::structs::Domain::Room {
                room: room.clone(),
            };
            tx.insert_domain(room_id.clone(), domain)?;

            // Add the creator as a member
            tx.add_user_to_domain(user_id, &room_id, citadel_workspace_types::structs::UserRole::Owner)?;

            // Add the room to the office
            if let Some(mut office) = tx.get_office(office_id).cloned() {
                office.rooms.push(room_id);
                tx.insert_office(office_id.to_string(), office)?;
            }

            Ok(room)
        })
    }
}
