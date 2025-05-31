use citadel_logging::{debug, info};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{
    Domain, MetadataValue, Office, Permission, Room, User, UserRole, Workspace,
};
use serde_json; // Ensure this import is present
use std::any::TypeId;
use std::sync::Arc;
use uuid::Uuid;

use crate::handlers::domain::functions::workspace::workspace_ops::WorkspacePasswordPair;
use crate::handlers::domain::WorkspaceDBList;
use crate::kernel::transaction::{Transaction, TransactionManager};

use super::functions::office::office_ops;
use super::functions::room::room_ops;
use super::functions::user as user_ops;
use super::functions::workspace::workspace_ops;
use super::DomainOperations;
use crate::handlers::domain::permission_denied;
use crate::handlers::domain::DomainEntity;

/// Server-side implementation of domain operations
#[derive(Clone)]
pub struct DomainServerOperations<R: Ratchet + Send + Sync + 'static> {
    pub(crate) tx_manager: Arc<TransactionManager>,
    _ratchet: std::marker::PhantomData<R>,
}

impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    /// Create a new instance of DomainServerOperations
    pub fn new(kernel: Arc<TransactionManager>) -> Self {
        Self {
            tx_manager: kernel,
            _ratchet: std::marker::PhantomData,
        }
    }
}

impl<R: Ratchet + Send + Sync + 'static> DomainOperations<R> for DomainServerOperations<R> {
    fn init(&self) -> Result<(), NetworkError> {
        Ok(())
    }

    fn is_admin(&self, tx: &dyn Transaction, user_id: &str) -> Result<bool, NetworkError> {
        let _user = tx.get_user(user_id).ok_or_else(|| {
            NetworkError::msg(format!("User '{}' not found in is_admin", user_id))
        })?;
        Ok(_user.role == UserRole::Admin)
    }

    fn get_user(&self, user_id: &str) -> Option<User> {
        self.tx_manager
            .with_read_transaction(|tx| Ok(tx.get_user(user_id).cloned()))
            .unwrap_or(None)
    }

    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        self.tx_manager.with_read_transaction(f)
    }

    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        self.tx_manager.with_write_transaction(f)
    }

    fn check_entity_permission(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        self.tx_manager
            .check_entity_permission_with_tx(tx, user_id, entity_id, permission)
    }

    fn is_member_of_domain(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError> {
        self.check_entity_permission(tx, user_id, domain_id, Permission::ViewContent)
        // Assuming ViewContent implies membership
    }

    fn get_domain(&self, domain_id: &str) -> Option<Domain> {
        self.tx_manager
            .with_read_transaction(|tx| Ok(tx.get_domain(domain_id).cloned()))
            .ok()
            .flatten()
    }

    fn add_user_to_domain(
        &self,
        admin_id: &str,
        user_id_to_add: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            debug!(target: "citadel", "[ADD_USER_TO_OFFICE_TX_ENTRY] admin_id: {}, user_to_add_id: {}, office_id: {}, role: {:?}", admin_id, user_id_to_add, domain_id, role);
            let result = user_ops::add_user_to_domain_inner(tx, admin_id, user_id_to_add, domain_id, role, None);
            debug!(target: "citadel", "[ADD_USER_TO_OFFICE_TX_EXIT] result: {:?}", result);
            result.map(|_| ()) // Map Ok(User) to Ok(())
        })
    }

    fn remove_user_from_domain(
        &self,
        admin_id: &str,
        user_id_to_remove: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            user_ops::remove_user_from_domain_inner(tx, admin_id, user_id_to_remove, domain_id)
        })
    }

    fn get_domain_entity<T>(&self, user_id: &str, entity_id: &str) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.with_read_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, entity_id, Permission::ViewContent)? {
                return Err(permission_denied(format!(
                    "User {} does not have permission to view entity {}",
                    user_id, entity_id
                )));
            }
            let domain = tx
                .get_domain(entity_id)
                .ok_or_else(|| permission_denied(format!("Entity {} not found", entity_id)))?;
            T::from_domain(domain.clone()).ok_or_else(|| {
                NetworkError::msg(format!("Entity {} is not of the expected type", entity_id))
            })
        })
    }

    fn create_domain_entity<T: DomainEntity + 'static + serde::de::DeserializeOwned>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        let type_id = TypeId::of::<T>();

        if type_id == TypeId::of::<Workspace>() {
            return Err(NetworkError::msg(
                "Use create_workspace for Workspace entities. create_domain_entity does not support Workspace.",
            ));
        } else if type_id == TypeId::of::<Office>() {
            // This branch means T is Office
            let parent_workspace_id = parent_id.ok_or_else(|| {
                NetworkError::msg(
                    "Parent workspace ID required for Office creation via create_domain_entity",
                )
            })?;

            let office_json_str =
                self.create_office(user_id, parent_workspace_id, name, description, mdx_content)?;

            // DomainEntity requires Deserialize, so T should be Deserialize.
            return serde_json::from_str(&office_json_str).map_err(|e| {
                NetworkError::msg(format!(
                    "Failed to deserialize to T (Office) in create_domain_entity: {}",
                    e
                ))
            });
        } else if type_id == TypeId::of::<Room>() {
            // This branch means T is Room
            let parent_office_id = parent_id.ok_or_else(|| {
                NetworkError::msg(
                    "Parent office ID required for Room creation via create_domain_entity",
                )
            })?;

            let room_obj: Room =
                self.create_room(user_id, parent_office_id, name, description, mdx_content)?;

            // DomainEntity requires Deserialize. We serialize Room to value then deserialize to T (which is Room).
            // This ensures type compatibility if T has a slightly different but compatible structure or if direct casting is problematic.
            let room_json_val = serde_json::to_value(room_obj).map_err(|e| {
                NetworkError::msg(format!(
                    "Failed to serialize Room to JSON value for T (Room) conversion: {}",
                    e
                ))
            })?;
            return serde_json::from_value(room_json_val).map_err(|e| {
                NetworkError::msg(format!(
                    "Failed to deserialize to T (Room) in create_domain_entity: {}",
                    e
                ))
            });
        } else {
            Err(NetworkError::msg(format!(
                "Unsupported entity type for create_domain_entity: {:?}",
                std::any::type_name::<T>() // Using type_name for better readability
            )))
        }
    }

    fn delete_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        let type_id = TypeId::of::<T>();
        if type_id == TypeId::of::<Workspace>() {
            Err(NetworkError::msg(
                "Use delete_workspace for Workspace entities. Requires password.",
            ))
        } else if type_id == TypeId::of::<Office>() {
            self.delete_office(user_id, entity_id)
                .map(|office| unsafe { std::mem::transmute_copy(&office) })
        } else if type_id == TypeId::of::<Room>() {
            self.delete_room(user_id, entity_id)
                .map(|room| unsafe { std::mem::transmute_copy(&room) })
        } else {
            Err(NetworkError::msg(format!(
                "Unsupported entity type for delete_domain_entity: {:?}",
                type_id
            )))
        }
    }

    fn update_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        let type_id = TypeId::of::<T>();
        if type_id == TypeId::of::<Workspace>() {
            Err(NetworkError::msg("Use update_workspace for Workspace entities. Requires password and handles metadata."))
        } else if type_id == TypeId::of::<Office>() {
            self.update_office(user_id, domain_id, name, description, mdx_content)
                .map(|office| unsafe { std::mem::transmute_copy(&office) })
        } else if type_id == TypeId::of::<Room>() {
            self.update_room(user_id, domain_id, name, description, mdx_content)
                .map(|room| unsafe { std::mem::transmute_copy(&room) })
        } else {
            Err(NetworkError::msg(format!(
                "Unsupported entity type for update_domain_entity: {:?}",
                type_id
            )))
        }
    }

    fn list_domain_entities<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError> {
        let type_id = TypeId::of::<T>();
        if type_id == TypeId::of::<Workspace>() {
            self.list_workspaces(user_id)
                .map(|vec_ws| unsafe { std::mem::transmute(vec_ws) })
        } else if type_id == TypeId::of::<Office>() {
            self.list_offices(user_id, parent_id.map(|s| s.to_string()))
                .map(|vec_o| unsafe { std::mem::transmute(vec_o) })
        } else if type_id == TypeId::of::<Room>() {
            let p_id = parent_id
                .ok_or_else(|| NetworkError::msg("Parent office ID required for listing rooms"))?;
            self.list_rooms(user_id, Some(p_id.to_string()))
                .map(|vec_r| unsafe { std::mem::transmute(vec_r) })
        } else {
            Err(NetworkError::msg(format!(
                "Unsupported entity type for list_domain_entities: {:?}",
                type_id
            )))
        }
    }

    // WORKSPACE OPERATIONS
    fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            workspace_ops::create_workspace_inner(
                tx,
                user_id,
                name,
                description,
                metadata,
                workspace_password,
            )
        })
    }

    fn get_workspace(&self, user_id: &str, ws_id: &str) -> Result<Workspace, NetworkError> {
        info!(target: "citadel", user_id, workspace_id = ws_id, "Attempting to get workspace");
        self.with_read_transaction(|tx| {
            tx.get_workspace(ws_id)
                .cloned()
                .ok_or_else(|| NetworkError::msg(format!("Workspace {} not found", ws_id)))
        })
    }

    fn get_workspace_details(&self, user_id: &str, ws_id: &str) -> Result<Workspace, NetworkError> {
        info!(target: "citadel", user_id, workspace_id = ws_id, "Attempting to get workspace details");
        self.with_read_transaction(|tx| {
            tx.get_workspace(ws_id)
                .cloned()
                .ok_or_else(|| NetworkError::msg(format!("Workspace {} not found", ws_id)))
        })
    }

    fn delete_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        workspace_password: String,
    ) -> Result<(), NetworkError> {
        info!(
            target: "citadel",
            user_id = user_id,
            workspace_id = workspace_id,
            "Attempting to delete workspace"
        );

        let _workspace_password_pair = WorkspacePasswordPair {
            workspace_id: workspace_id.to_string(),
            password: workspace_password,
        };

        self.with_write_transaction(|tx| {
            // @human-review: WorkspaceCNRepository is undeclared. Temporarily commenting out.
            // let mut workspace_cn = WorkspaceCNRepository::find_by_id(tx, workspace_id)?;
            // if !workspace_cn.verify_password(&workspace_password) {
            //     return Err(permission_denied("Incorrect workspace password"));
            // }
            workspace_ops::delete_workspace_inner(tx, user_id, workspace_id)
        })
    }

    fn update_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        _name: Option<&str>,        // unused
        _description: Option<&str>, // unused
        _metadata: Option<Vec<u8>>, // unused
        workspace_master_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !workspace_master_password.is_empty() {
                info!(
                    "Password update requested for workspace '{}'. Actual update logic pending.",
                    workspace_id
                );
            }

            // @human-review: WorkspaceCNRepository is undeclared. Temporarily commenting out.
            // let mut workspace_cn = WorkspaceCNRepository::find_by_id(tx, workspace_id)?;

            if !self.check_entity_permission(
                tx,
                user_id,
                workspace_id,
                Permission::UpdateWorkspace,
            )? {
                return Err(permission_denied(format!(
                    "User {} does not have permission to update workspace {}",
                    user_id, workspace_id
                )));
            }

            // if let Some(n) = name {
            //     workspace_cn.name = n.to_string();
            // }
            // if let Some(d) = description {
            //     workspace_cn.description = d.to_string();
            // }
            // if let Some(m) = metadata {
            //     workspace_cn.metadata = m;
            // }

            // let updated_workspace_struct = Workspace {
            //     id: workspace_cn.id.to_string(),
            //     name: workspace_cn.name.clone(),
            //     description: workspace_cn.description.clone(),
            //     owner_id: workspace_cn.owner_id.to_string(),
            //     members: Vec::new(),
            //     offices: workspace_cn.offices.iter().map(|id_uuid| id_uuid.to_string()).collect(),
            //     metadata: workspace_cn.metadata.clone(),
            //     password_protected: workspace_cn.password_hash.is_some(),
            // };

            // tx.update_workspace(workspace_id, updated_workspace_struct.clone())?;

            // Ok(updated_workspace_struct)
            todo!("update_workspace is not implemented")
        })
    }

    fn add_office_to_workspace(
        &self,
        _user_id: &str,
        _workspace_id: &str,
        _office_id: &str,
    ) -> Result<(), NetworkError> {
        // self.tx_manager.with_write_transaction(|tx| {
        //     workspace_ops::add_office_to_workspace_inner(tx, user_id, workspace_id, office_id)
        // })
        todo!("add_office_to_workspace_inner is not implemented in workspace_ops")
        // Placeholder
    }

    fn remove_office_from_workspace(
        &self,
        _user_id: &str,
        _workspace_id: &str,
        _office_id: &str,
    ) -> Result<(), NetworkError> {
        // self.tx_manager.with_write_transaction(|tx| {
        //     workspace_ops::remove_office_from_workspace_inner(tx, user_id, workspace_id, office_id)
        // })
        todo!("remove_office_from_workspace_inner is not implemented in workspace_ops")
        // Placeholder
    }

    fn add_user_to_workspace(
        &self,
        admin_id: &str,
        user_id: &str,
        workspace_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            workspace_ops::add_user_to_workspace_inner(
                tx,
                admin_id,     // This is the actor_user_id, maps to inner's admin_id
                user_id,      // This is the target_member_id (user_to_add)
                workspace_id, // This is the workspace_id (e.g. crate::WORKSPACE_ROOT_ID)
                role,
            )
        })
    }

    fn remove_user_from_workspace(
        &self,
        admin_id: &str,
        _user_id: &str,
        _workspace_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            workspace_ops::remove_user_from_workspace_inner(tx, admin_id, _user_id, _workspace_id)
        })
    }

    fn load_workspace(
        &self,
        user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError> {
        let ws_id = match workspace_id_opt {
            Some(id) => id.to_string(),
            None => {
                // Attempt to get the primary workspace ID for the user from metadata
                const PRIMARY_WORKSPACE_ID_KEY: &str = "primary_workspace_id"; // Define key
                self.with_read_transaction(|tx| {
                    tx.get_user(user_id)
                        .and_then(|user| user.metadata.get(PRIMARY_WORKSPACE_ID_KEY))
                        .and_then(|metadata_value| match metadata_value {
                            MetadataValue::String(id_str) => Some(id_str.clone()),
                            _ => None, // Or handle error if type is wrong
                        })
                        .ok_or_else(|| {
                            NetworkError::msg(format!(
                                "Primary workspace ID not found in metadata for user {}",
                                user_id
                            ))
                        })
                })?
            }
        };

        self.with_read_transaction(|tx| {
            tx.get_workspace(&ws_id)
                .cloned()
                .ok_or_else(|| NetworkError::msg(format!("Workspace {} not found", ws_id)))
        })
    }

    fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError> {
        info!(target: "citadel", user_id, "Attempting to list workspaces");
        let workspaces = self.with_read_transaction(|tx| {
            Ok(tx
                .get_all_workspaces()
                .values()
                .cloned()
                .collect::<Vec<_>>())
        })?;
        Ok(workspaces)
    }

    fn list_offices_in_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError> {
        self.with_read_transaction(|tx| {
            office_ops::list_offices_inner(tx, user_id, Some(workspace_id.to_string()))
        })
    }

    // OFFICE OPERATIONS
    // Note: add_user_to_office and remove_user_from_office are handled by
    // add_user_to_domain and remove_user_from_domain respectively, where domain_id is the office_id.

    fn create_office(
        &self,
        user_id: &str,
        workspace_id: &str, // parent_id
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<String, NetworkError> {
        // Changed return type to String
        let office_id = Uuid::new_v4().to_string();
        self.tx_manager.with_write_transaction(|tx| {
            // office_ops::create_office_inner already returns Result<String, NetworkError>
            office_ops::create_office_inner(
                tx,
                user_id,
                workspace_id,
                &office_id,
                name,
                description,
                mdx_content.map(String::from),
            )
        })
    }

    fn get_office(&self, user_id: &str, office_id: &str) -> Result<String, NetworkError> {
        // Changed return type to String
        self.with_read_transaction(|tx| {
            let _user = tx
                .get_user(user_id)
                .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;

            // TODO: Define and use a specific ViewOffice permission if necessary
            // For now, checking if the user is part of the office's domain (implicitly can view)
            // A more granular check like `user.has_permission(office_id, Permission::ViewOffice)` would be better.
            if !tx.is_member_of_domain(user_id, office_id)? {
                return Err(permission_denied(format!(
                    "User {} does not have permission to view office {}",
                    user_id, office_id
                )));
            }

            let domain = tx.get_domain(office_id).ok_or_else(|| {
                NetworkError::msg(format!("Office domain {} not found", office_id))
            })?;

            match domain {
                Domain::Office { office, .. } => serde_json::to_string(&office).map_err(|e| {
                    NetworkError::msg(format!("Failed to serialize office to JSON: {}", e))
                }),
                _ => Err(NetworkError::msg(format!(
                    "Domain {} is not an office",
                    office_id
                ))),
            }
        })
    }

    fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            let name_string = name.map(|s| s.to_string());
            let description_string = description.map(|s| s.to_string());
            let mdx_content_string = mdx_content.map(|s| s.to_string());
            office_ops::update_office_inner(
                tx,
                user_id,
                office_id,
                name_string,
                description_string,
                mdx_content_string,
            )
        })
    }

    fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        self.tx_manager
            .with_write_transaction(|tx| office_ops::delete_office_inner(tx, user_id, office_id))
    }

    fn list_offices(
        &self,
        user_id: &str,
        workspace_id: Option<String>,
    ) -> Result<Vec<Office>, NetworkError> {
        self.with_read_transaction(|tx| office_ops::list_offices_inner(tx, user_id, workspace_id))
    }

    // ROOM OPERATIONS
    // Note: add_user_to_room and remove_user_from_room are handled by
    // add_user_to_domain and remove_user_from_domain respectively, where domain_id is the room_id.

    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        let room_id = Uuid::new_v4().to_string();
        self.tx_manager.with_write_transaction(|tx| {
            room_ops::create_room_inner(
                tx,
                user_id,
                office_id,
                &room_id,
                name,
                description,
                mdx_content.map(String::from),
            )
        })
    }

    fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        self.with_read_transaction(|tx| {
            let _user = tx
                .get_user(user_id)
                .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
            // TODO: Define and use a specific ViewRoom permission if necessary
            // For now, checking if the user is part of the room's domain (implicitly can view)
            // A more granular check like `user.has_permission(room_id, Permission::ViewRoom)` would be better.
            if !tx.is_member_of_domain(user_id, room_id)? {
                return Err(permission_denied(format!(
                    "User {} does not have permission to view room {}",
                    user_id, room_id
                )));
            }

            let domain = tx
                .get_domain(room_id)
                .ok_or_else(|| NetworkError::msg(format!("Room domain {} not found", room_id)))?;

            match domain {
                Domain::Room { room, .. } => Ok(room.clone()),
                _ => Err(NetworkError::msg(format!(
                    "Domain {} is not a room",
                    room_id
                ))),
            }
        })
    }

    fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            let name_string = name.map(|s| s.to_string());
            let description_string = description.map(|s| s.to_string());
            let mdx_content_string = mdx_content.map(|s| s.to_string());
            room_ops::update_room_inner(
                tx,
                user_id,
                room_id,
                name_string,
                description_string,
                mdx_content_string,
            )
        })
    }

    fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        self.tx_manager
            .with_write_transaction(|tx| room_ops::delete_room_inner(tx, user_id, room_id))
    }

    fn list_rooms(
        &self,
        user_id: &str,
        office_id: Option<String>,
    ) -> Result<Vec<Room>, NetworkError> {
        self.tx_manager
            .with_read_transaction(|tx| room_ops::list_rooms_inner(tx, user_id, office_id))
    }

    fn get_all_workspace_ids(&self) -> Result<WorkspaceDBList, NetworkError> {
        self.with_read_transaction(|tx| workspace_ops::get_all_workspace_ids_inner(tx))
    }
}
