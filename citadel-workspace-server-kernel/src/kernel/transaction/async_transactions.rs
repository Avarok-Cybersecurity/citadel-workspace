//! # Async Transaction Module
//!
//! This module provides async read and write transactions that use the backend
//! for all persistence operations instead of in-memory HashMaps.

use crate::kernel::transaction::BackendTransactionManager;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{
    Domain, Office, Permission, Room, User, UserRole, Workspace,
};
use std::sync::Arc;

/// An async read-only transaction that fetches data from the backend
pub struct AsyncReadTransaction<R: Ratchet> {
    backend_tx_manager: Arc<BackendTransactionManager<R>>,
}

impl<R: Ratchet + Send + Sync + 'static> AsyncReadTransaction<R> {
    pub fn new(backend_tx_manager: Arc<BackendTransactionManager<R>>) -> Self {
        Self { backend_tx_manager }
    }

    pub async fn get_domain(&self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        self.backend_tx_manager.get_domain(domain_id).await
    }

    pub async fn get_user(&self, user_id: &str) -> Result<Option<User>, NetworkError> {
        self.backend_tx_manager.get_user(user_id).await
    }

    pub async fn get_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<Workspace>, NetworkError> {
        self.backend_tx_manager.get_workspace(workspace_id).await
    }

    pub async fn get_workspace_password(
        &self,
        workspace_id: &str,
    ) -> Result<Option<String>, NetworkError> {
        self.backend_tx_manager
            .get_workspace_password(workspace_id)
            .await
    }

    pub async fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError> {
        let workspaces = self.backend_tx_manager.get_all_workspaces().await?;
        Ok(workspaces
            .into_iter()
            .filter(|(_, w)| w.members.contains(&user_id.to_string()))
            .map(|(_, w)| w)
            .collect())
    }

    pub async fn list_offices(
        &self,
        user_id: &str,
        workspace_id: Option<String>,
    ) -> Result<Vec<Office>, NetworkError> {
        let domains = self.backend_tx_manager.get_all_domains().await?;
        let mut offices = Vec::new();

        for (_, domain) in domains {
            if let Domain::Office { office } = domain {
                if office.members.contains(&user_id.to_string()) {
                    if let Some(ref wid) = workspace_id {
                        if office.workspace_id == *wid {
                            offices.push(office);
                        }
                    } else {
                        offices.push(office);
                    }
                }
            }
        }

        Ok(offices)
    }

    pub async fn list_rooms(
        &self,
        user_id: &str,
        office_id: Option<String>,
    ) -> Result<Vec<Room>, NetworkError> {
        let domains = self.backend_tx_manager.get_all_domains().await?;
        let mut rooms = Vec::new();

        for (_, domain) in domains {
            if let Domain::Room { room } = domain {
                if room.members.contains(&user_id.to_string()) {
                    if let Some(ref oid) = office_id {
                        if room.office_id == *oid {
                            rooms.push(room);
                        }
                    } else {
                        rooms.push(room);
                    }
                }
            }
        }

        Ok(rooms)
    }
}

/// An async write transaction that performs operations on the backend
pub struct AsyncWriteTransaction<R: Ratchet> {
    backend_tx_manager: Arc<BackendTransactionManager<R>>,
}

impl<R: Ratchet + Send + Sync + 'static> AsyncWriteTransaction<R> {
    pub fn new(backend_tx_manager: Arc<BackendTransactionManager<R>>) -> Self {
        Self { backend_tx_manager }
    }

    pub async fn set_workspace_password(
        &self,
        workspace_id: &str,
        password: &str,
    ) -> Result<(), NetworkError> {
        self.backend_tx_manager
            .set_workspace_password(workspace_id, password)
            .await
    }

    pub async fn insert_domain(
        &self,
        domain_id: String,
        domain: Domain,
    ) -> Result<(), NetworkError> {
        self.backend_tx_manager
            .insert_domain(domain_id, domain)
            .await
    }

    pub async fn insert_workspace(
        &self,
        workspace_id: String,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        self.backend_tx_manager
            .insert_workspace(workspace_id, workspace)
            .await
    }

    pub async fn insert_user(&self, user_id: String, user: User) -> Result<(), NetworkError> {
        self.backend_tx_manager.insert_user(user_id, user).await
    }

    pub async fn update_domain(&self, domain_id: &str, domain: Domain) -> Result<(), NetworkError> {
        self.backend_tx_manager
            .update_domain(domain_id, domain)
            .await
    }

    pub async fn update_workspace(
        &self,
        workspace_id: &str,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        self.backend_tx_manager
            .update_workspace(workspace_id, workspace)
            .await
    }

    pub async fn update_user(&self, user_id: &str, user: User) -> Result<(), NetworkError> {
        self.backend_tx_manager.update_user(user_id, user).await
    }

    pub async fn remove_domain(&self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        self.backend_tx_manager.remove_domain(domain_id).await
    }

    pub async fn remove_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<Workspace>, NetworkError> {
        self.backend_tx_manager.remove_workspace(workspace_id).await
    }

    pub async fn remove_user(&self, user_id: &str) -> Result<Option<User>, NetworkError> {
        self.backend_tx_manager.remove_user(user_id).await
    }

    pub async fn add_user_to_domain(
        &self,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Get the domain
        if let Some(mut domain) = self.backend_tx_manager.get_domain(domain_id).await? {
            // Add user to domain members
            match &mut domain {
                Domain::Workspace { workspace } => {
                    if !workspace.members.contains(&user_id.to_string()) {
                        workspace.members.push(user_id.to_string());
                    }
                }
                Domain::Office { office } => {
                    if !office.members.contains(&user_id.to_string()) {
                        office.members.push(user_id.to_string());
                    }
                }
                Domain::Room { room } => {
                    if !room.members.contains(&user_id.to_string()) {
                        room.members.push(user_id.to_string());
                    }
                }
            }

            // Update the domain
            self.update_domain(domain_id, domain).await?;

            // Update user permissions
            if let Some(mut user) = self.backend_tx_manager.get_user(user_id).await? {
                // Add domain permissions based on role
                let permissions = match role {
                    UserRole::Admin => vec![Permission::All],
                    UserRole::Member => vec![
                        Permission::CreateRoom,
                        Permission::SendMessages,
                        Permission::ReadMessages,
                    ],
                    UserRole::Guest => vec![Permission::ReadMessages],
                    UserRole::Owner => vec![Permission::All],
                    UserRole::Banned => vec![],
                    UserRole::Custom(_, _) => vec![], // Custom roles start with no default permissions
                };

                user.permissions
                    .insert(domain_id.to_string(), permissions.into_iter().collect());

                self.update_user(user_id, user).await?;
            }
        }

        Ok(())
    }

    pub async fn remove_user_from_domain(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        // Get the domain
        if let Some(mut domain) = self.backend_tx_manager.get_domain(domain_id).await? {
            // Remove user from domain members
            match &mut domain {
                Domain::Workspace { workspace } => {
                    workspace.members.retain(|m| m != user_id);
                }
                Domain::Office { office } => {
                    office.members.retain(|m| m != user_id);
                }
                Domain::Room { room } => {
                    room.members.retain(|m| m != user_id);
                }
            }

            // Update the domain
            self.update_domain(domain_id, domain).await?;

            // Remove user permissions for this domain
            if let Some(mut user) = self.backend_tx_manager.get_user(user_id).await? {
                user.permissions.remove(domain_id);
                self.update_user(user_id, user).await?;
            }
        }

        Ok(())
    }
}
