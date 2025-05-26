use citadel_sdk::prelude::*;
use citadel_workspace_types::structs::{Domain, UserRole};
use crate::handlers::domain::server_ops::ServerDomainOps;

impl<R: Ratchet> ServerDomainOps<R> {
    pub(crate) fn add_user_to_domain_inner(&self, user_id: &str, domain_id: &str, role: UserRole) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            let domain = tx
                .get_domain(domain_id)
                .cloned()
                .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;
            let mut user = tx
                .get_user(user_id)
                .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?.clone();
            
            // Update domain with updated user list
            match domain {
                Domain::Office { mut office } => {
                    // Add user to members if not already present
                    if !office.members.contains(&user_id.to_string()) {
                        office.members.push(user_id.to_string());
                    }
                    let updated_domain = Domain::Office { office };
                    tx.update_domain(domain_id, updated_domain)?;
                }
                Domain::Room { mut room } => {
                    // Add user to members if not already present
                    if !room.members.contains(&user_id.to_string()) {
                        room.members.push(user_id.to_string());
                    }
                    let updated_domain = Domain::Room { room };
                    tx.update_domain(domain_id, updated_domain)?;
                }
                Domain::Workspace { mut workspace } => {
                    // Add user to members if not already present
                    if !workspace.members.contains(&user_id.to_string()) {
                        workspace.members.push(user_id.to_string());
                    }
                    let updated_domain = Domain::Workspace { workspace };
                    tx.update_domain(domain_id, updated_domain)?;
                }
            }

            user.role = role;
            tx.update_user(user_id, user)?;
            Ok(())
        })
    }


    pub(crate) fn remove_user_from_domain_inner(&self, user_id: &str, domain_id: &str) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Get domain by ID
            let domain = tx
                .get_domain(domain_id)
                .cloned()
                .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;
    
            // Remove user from domain
            match domain {
                Domain::Office { mut office } => {
                    // Remove user from members
                    office.members.retain(|id| id != user_id);
                    let updated_domain = Domain::Office { office };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
                Domain::Room { mut room } => {
                    // Remove user from members
                    room.members.retain(|id| id != user_id);
                    let updated_domain = Domain::Room { room };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
                Domain::Workspace { mut workspace } => {
                    // Remove user from members
                    workspace.members.retain(|id| id != user_id);
                    let updated_domain = Domain::Workspace { workspace };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
            }
        })
    }
}