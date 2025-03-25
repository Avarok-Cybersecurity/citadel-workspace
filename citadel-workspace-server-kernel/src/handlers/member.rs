use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::collections::{HashMap, HashSet};

use crate::handlers::transaction::Transaction;
use crate::kernel::WorkspaceServerKernel;
use crate::structs::{Domain, Permission, User, UserRole};

// Member handlers - functions for adding, removing, and updating workspace members
impl<R: Ratchet> WorkspaceServerKernel<R> {
    pub fn add_member(
        &self,
        admin_id: &str,
        user_id: &str,
        office_id: Option<&str>,
        room_id: Option<&str>,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission
        if !self.is_admin(admin_id) {
            return Err(NetworkError::msg(
                "Permission denied: Only admins can add members",
            ));
        }

        // Validate inputs
        if user_id.is_empty() {
            return Err(NetworkError::msg("Cannot add member with empty user_id"));
        }

        self.with_write_transaction(|tx| {
            let user_exists = tx.get_user(user_id).is_some();

            if !user_exists {
                // Create new user if they don't exist
                let new_user = User {
                    id: user_id.to_string(),
                    name: format!("User {}", user_id),
                    role,
                    permissions: HashMap::new(),
                };
                tx.insert_user(user_id.to_string(), new_user)?;
            } else {
                // Update role if user exists
                let mut user = tx.get_user(user_id).cloned().unwrap();
                user.role = role;
                tx.update_user(user_id, user)?;
            }

            // Add to office if specified
            if let Some(office_id) = office_id {
                if let Some(Domain::Office { mut office }) = tx.get_domain(office_id).cloned() {
                    if !office.members.contains(&user_id.to_string()) {
                        office.members.push(user_id.to_string());
                        tx.update_domain(office_id, Domain::Office { office })?;
                    }
                }
            }

            // Add to room if specified
            if let Some(room_id) = room_id {
                if let Some(Domain::Room { mut room }) = tx.get_domain(room_id).cloned() {
                    if !room.members.contains(&user_id.to_string()) {
                        room.members.push(user_id.to_string());
                        tx.update_domain(room_id, Domain::Room { room })?;
                    }
                }
            }

            // Add relevant permissions for the office
            if let Some(office_id) = office_id {
                self.grant_domain_permissions_internal(user_id, office_id, tx)?;
            }

            // Add relevant permissions for the room
            if let Some(room_id) = room_id {
                self.grant_domain_permissions_internal(user_id, room_id, tx)?;
            }

            Ok(())
        })
    }

    pub fn add_member_to_domain(&self, user_id: &str, domain_id: &str) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if user exists
            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User {} not found", user_id)));
            }

            // Check if domain exists and add user
            if let Some(domain) = tx.get_domain(domain_id).cloned() {
                match domain {
                    Domain::Office { mut office } => {
                        if !office.members.contains(&user_id.to_string()) {
                            office.members.push(user_id.to_string());
                            tx.update_domain(domain_id, Domain::Office { office })?;
                        }
                    }
                    Domain::Room { mut room } => {
                        if !room.members.contains(&user_id.to_string()) {
                            room.members.push(user_id.to_string());
                            tx.update_domain(domain_id, Domain::Room { room })?;
                        }
                    }
                }

                // Add permissions for the domain
                self.grant_domain_permissions_internal(user_id, domain_id, tx)?;

                Ok(())
            } else {
                Err(NetworkError::msg(format!("Domain {} not found", domain_id)))
            }
        })
    }

    pub fn remove_member(&self, user_id: &str) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            // First collect all domains that need updating
            let domains_to_update: Vec<(String, Domain)> = tx
                .get_all_domains()
                .iter()
                .filter_map(|(domain_id, domain)| match &domain {
                    Domain::Office { office } if office.members.contains(&user_id.to_string()) => {
                        let mut office_clone = office.clone();
                        office_clone.members.retain(|id| id != user_id);
                        Some((
                            domain_id.clone(),
                            Domain::Office {
                                office: office_clone,
                            },
                        ))
                    }
                    Domain::Room { room } if room.members.contains(&user_id.to_string()) => {
                        let mut room_clone = room.clone();
                        room_clone.members.retain(|id| id != user_id);
                        Some((domain_id.clone(), Domain::Room { room: room_clone }))
                    }
                    _ => None,
                })
                .collect();

            // Now update each domain without holding a reference to tx.get_all_domains()
            for (domain_id, updated_domain) in domains_to_update {
                tx.update_domain(&domain_id, updated_domain)?;
            }

            // Remove user
            tx.remove_user(user_id)?;
            Ok(())
        })
    }

    pub fn remove_member_from_domain(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if the domain exists
            if let Some(domain) = tx.get_domain(domain_id).cloned() {
                // Check if the user exists
                if tx.get_user(user_id).is_none() {
                    return Err(NetworkError::msg(format!("User {} not found", user_id)));
                }

                // Update domain to remove user
                let updated_domain = match domain {
                    Domain::Office { mut office } => {
                        office.members.retain(|id| id != user_id);
                        Domain::Office { office }
                    }
                    Domain::Room { mut room } => {
                        room.members.retain(|id| id != user_id);
                        Domain::Room { room }
                    }
                };

                // Update the domain
                tx.update_domain(domain_id, updated_domain)?;

                // Remove permissions for this domain
                self.revoke_domain_permissions_internal(user_id, domain_id, tx)?;

                Ok(())
            } else {
                Err(NetworkError::msg(format!("Domain {} not found", domain_id)))
            }
        })
    }

    pub fn update_member_role(
        &self,
        admin_id: &str,
        user_id: &str,
        new_role: UserRole,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission
        if !self.is_admin(admin_id) {
            return Err(NetworkError::msg(
                "Permission denied: Only admins can update member roles",
            ));
        }

        self.with_write_transaction(|tx| {
            // Update the user's role
            if let Some(mut user) = tx.get_user(user_id).cloned() {
                user.role = new_role;
                tx.update_user(user_id, user)?;
                Ok(())
            } else {
                Err(NetworkError::msg(format!("User {} not found", user_id)))
            }
        })
    }

    pub fn update_member_permissions(
        &self,
        admin_id: &str,
        user_id: &str,
        domain_id: &str,
        permissions: HashSet<Permission>,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission
        if !self.is_admin(admin_id) {
            return Err(NetworkError::msg(
                "Permission denied: Only admins can update permissions",
            ));
        }

        self.with_write_transaction(|tx| {
            // Update user permissions
            if let Some(mut user) = tx.get_user(user_id).cloned() {
                // Clear existing permissions for this domain
                user.clear_permissions(domain_id);

                // Add new permissions
                for permission in permissions {
                    user.add_permission(domain_id, permission);
                }

                // Update the user
                tx.update_user(user_id, user)?;
                Ok(())
            } else {
                Err(NetworkError::msg(format!("User {} not found", user_id)))
            }
        })
    }

    pub fn get_member(&self, user_id: &str) -> Option<User> {
        self.with_read_transaction(|tx| Ok(tx.get_user(user_id).cloned()))
            .unwrap_or(None)
    }

    pub fn get_all_members(&self) -> Result<Vec<User>, NetworkError> {
        self.with_read_transaction(|tx| {
            let mut members = Vec::new();
            for user in tx.get_all_users().values() {
                members.push(user.clone());
            }
            Ok(members)
        })
    }

    fn grant_domain_permissions_internal(
        &self,
        user_id: &str,
        domain_id: &str,
        tx: &mut dyn Transaction,
    ) -> Result<(), NetworkError> {
        // Fetch the domain to determine what permissions to grant
        if let Some(domain) = tx.get_domain(domain_id) {
            // Fetch the user to update permissions
            if let Some(mut user) = tx.get_user(user_id).cloned() {
                match domain {
                    Domain::Office { office: _ } => {
                        // Grant office-specific permissions
                        user.add_permission(domain_id, Permission::ViewContent);
                        user.add_permission(domain_id, Permission::EditMdx);
                        user.add_permission(domain_id, Permission::EditOfficeConfig);
                        tx.update_user(user_id, user)?;
                    }
                    Domain::Room { room: _ } => {
                        // Grant room-specific permissions
                        user.add_permission(domain_id, Permission::ViewContent);
                        user.add_permission(domain_id, Permission::EditMdx);
                        tx.update_user(user_id, user)?;
                    }
                }
                Ok(())
            } else {
                Err(NetworkError::msg(format!("User {} not found", user_id)))
            }
        } else {
            Err(NetworkError::msg(format!("Domain {} not found", domain_id)))
        }
    }

    fn revoke_domain_permissions_internal(
        &self,
        user_id: &str,
        domain_id: &str,
        tx: &mut dyn Transaction,
    ) -> Result<(), NetworkError> {
        // Fetch the user to update permissions
        if let Some(mut user) = tx.get_user(user_id).cloned() {
            // Clear all permissions for this domain
            user.clear_permissions(domain_id);
            tx.update_user(user_id, user)?;
            Ok(())
        } else {
            Err(NetworkError::msg(format!("User {} not found", user_id)))
        }
    }

    // Use the existing is_admin method from permissions.rs instead of duplicating
    // fn is_admin(&self, user_id: &str) -> bool {
    //     self.with_read_transaction(|tx| {
    //         if let Some(user) = tx.get_user(user_id) {
    //             user.role == UserRole::Admin
    //         } else {
    //             false
    //         }
    //     }).unwrap_or(false)
    // }

    // Use the existing is_member_of_domain method from domain/mod.rs instead of duplicating
    // pub fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
    //     self.with_read_transaction(|tx| {
    //         // Check if domain exists
    //         if let Some(domain) = tx.get_domain(domain_id) {
    //             match domain {
    //                 Domain::Office { office } => {
    //                     Ok(office.members.contains(&user_id.to_string()))
    //                 }
    //                 Domain::Room { room } => {
    //                     Ok(room.members.contains(&user_id.to_string()))
    //                 }
    //             }
    //         } else {
    //             Err(NetworkError::msg(format!("Domain {} not found", domain_id)))
    //         }
    //     })
    // }
}
