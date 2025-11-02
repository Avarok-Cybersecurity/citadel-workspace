//! Simplified backend operations for BackendTransactionManager
//!
//! This module provides simple async methods for the BackendTransactionManager without complex lifetimes.

use crate::kernel::transaction::BackendTransactionManager;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, Office, Room, User, Workspace};

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    /// Initialize the backend transaction manager
    pub async fn init(&self) -> Result<(), NetworkError> {
        // No special initialization needed for now
        // The backend is already initialized through NodeRemote
        Ok(())
    }
    /// Simple method to get a domain
    pub async fn get_domain(&self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        let domains = self.get_all_domains().await?;
        Ok(domains.get(domain_id).cloned())
    }

    /// Simple method to get a user
    pub async fn get_user(&self, user_id: &str) -> Result<Option<User>, NetworkError> {
        let users = self.get_all_users().await?;
        Ok(users.get(user_id).cloned())
    }

    /// Simple method to get a workspace
    pub async fn get_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<Workspace>, NetworkError> {
        let workspaces = self.get_all_workspaces().await?;
        Ok(workspaces.get(workspace_id).cloned())
    }

    /// Simple method to insert a domain
    pub async fn insert_domain(
        &self,
        domain_id: String,
        domain: Domain,
    ) -> Result<(), NetworkError> {
        let mut domains = self.get_all_domains().await?;
        domains.insert(domain_id, domain);
        self.save_domains(&domains).await
    }

    /// Simple method to insert a user
    pub async fn insert_user(&self, user_id: String, user: User) -> Result<(), NetworkError> {
        let mut users = self.get_all_users().await?;
        users.insert(user_id, user);
        self.save_users(&users).await
    }

    /// Simple method to insert a workspace
    pub async fn insert_workspace(
        &self,
        workspace_id: String,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        let mut workspaces = self.get_all_workspaces().await?;
        workspaces.insert(workspace_id, workspace);
        self.save_workspaces(&workspaces).await
    }

    /// Simple method to remove a domain
    pub async fn remove_domain(&self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        let mut domains = self.get_all_domains().await?;
        let removed = domains.remove(domain_id);
        if removed.is_some() {
            self.save_domains(&domains).await?;
        }
        Ok(removed)
    }

    /// Simple method to remove a user
    pub async fn remove_user(&self, user_id: &str) -> Result<Option<User>, NetworkError> {
        let mut users = self.get_all_users().await?;
        let removed = users.remove(user_id);
        if removed.is_some() {
            self.save_users(&users).await?;
        }
        Ok(removed)
    }

    /// Simple method to remove a workspace
    pub async fn remove_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<Workspace>, NetworkError> {
        let mut workspaces = self.get_all_workspaces().await?;
        let removed = workspaces.remove(workspace_id);
        if removed.is_some() {
            self.save_workspaces(&workspaces).await?;
        }
        Ok(removed)
    }

    /// Simple method to get an office
    pub async fn get_office(&self, office_id: &str) -> Result<Option<Office>, NetworkError> {
        let domains = self.get_all_domains().await?;
        if let Some(Domain::Office { office }) = domains.get(office_id) {
            Ok(Some(office.clone()))
        } else {
            Ok(None)
        }
    }

    /// Simple method to insert an office
    pub async fn insert_office(
        &self,
        office_id: String,
        office: Office,
    ) -> Result<(), NetworkError> {
        let mut domains = self.get_all_domains().await?;
        domains.insert(office_id, Domain::Office { office });
        self.save_domains(&domains).await
    }

    /// Simple method to remove an office
    pub async fn remove_office(&self, office_id: &str) -> Result<Option<Office>, NetworkError> {
        let mut domains = self.get_all_domains().await?;
        if let Some(Domain::Office { office }) = domains.remove(office_id) {
            self.save_domains(&domains).await?;
            Ok(Some(office))
        } else {
            Ok(None)
        }
    }

    /// Simple method to get a room
    pub async fn get_room(&self, room_id: &str) -> Result<Option<Room>, NetworkError> {
        let domains = self.get_all_domains().await?;
        if let Some(Domain::Room { room }) = domains.get(room_id) {
            Ok(Some(room.clone()))
        } else {
            Ok(None)
        }
    }

    /// Simple method to insert a room
    pub async fn insert_room(&self, room_id: String, room: Room) -> Result<(), NetworkError> {
        let mut domains = self.get_all_domains().await?;
        domains.insert(room_id, Domain::Room { room });
        self.save_domains(&domains).await
    }

    /// Simple method to remove a room
    pub async fn remove_room(&self, room_id: &str) -> Result<Option<Room>, NetworkError> {
        let mut domains = self.get_all_domains().await?;
        if let Some(Domain::Room { room }) = domains.remove(room_id) {
            self.save_domains(&domains).await?;
            Ok(Some(room))
        } else {
            Ok(None)
        }
    }

    /// Get workspace password
    pub async fn get_workspace_password(
        &self,
        workspace_id: &str,
    ) -> Result<Option<String>, NetworkError> {
        let passwords = self.get_all_passwords().await?;
        Ok(passwords.get(workspace_id).cloned())
    }

    /// Set workspace password
    pub async fn set_workspace_password(
        &self,
        workspace_id: &str,
        password: &str,
    ) -> Result<(), NetworkError> {
        let mut passwords = self.get_all_passwords().await?;
        passwords.insert(workspace_id.to_string(), password.to_string());
        self.save_passwords(&passwords).await?;
        Ok(())
    }

    /// Update domain
    pub async fn update_domain(&self, domain_id: &str, domain: Domain) -> Result<(), NetworkError> {
        let mut domains = self.get_all_domains().await?;
        domains.insert(domain_id.to_string(), domain);
        self.save_domains(&domains).await?;
        Ok(())
    }

    /// Update workspace
    pub async fn update_workspace(
        &self,
        workspace_id: &str,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        let mut workspaces = self.get_all_workspaces().await?;
        workspaces.insert(workspace_id.to_string(), workspace);
        self.save_workspaces(&workspaces).await?;
        Ok(())
    }

    /// Update user
    pub async fn update_user(&self, user_id: &str, user: User) -> Result<(), NetworkError> {
        let mut users = self.get_all_users().await?;
        users.insert(user_id.to_string(), user);
        self.save_users(&users).await?;
        Ok(())
    }
}
