use crate::kernel::WorkspaceServerKernel;
use crate::structs::{Domain, User};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::collections::HashSet;

// Query handlers - functions for retrieving workspace information

#[allow(dead_code)]
impl<R: Ratchet> WorkspaceServerKernel<R> {
    // List members in an office or room
    pub fn list_members(
        &self,
        office_id: Option<&String>,
        room_id: Option<&String>,
    ) -> Result<Vec<User>, NetworkError> {
        self.with_read_transaction(|tx| {
            let mut members = Vec::new();

            match (office_id, room_id) {
                (Some(office_id), None) => {
                    // Get members of an office
                    match tx.get_domain(office_id) {
                        Some(Domain::Office { office }) => {
                            for member_id in &office.members {
                                if let Some(user) = tx.get_user(member_id) {
                                    members.push(user.clone());
                                }
                            }
                        }
                        _ => return Err(NetworkError::msg("Office not found")),
                    }
                }
                (None, Some(room_id)) => {
                    // Get members of a room
                    match tx.get_domain(room_id) {
                        Some(Domain::Room { room }) => {
                            for member_id in &room.members {
                                if let Some(user) = tx.get_user(member_id) {
                                    members.push(user.clone());
                                }
                            }
                        }
                        _ => return Err(NetworkError::msg("Room not found")),
                    }
                }
                (Some(office_id), Some(room_id)) => {
                    // Get members of both an office and a room
                    match tx.get_domain(office_id) {
                        Some(Domain::Office { office }) => {
                            match tx.get_domain(room_id) {
                                Some(Domain::Room { room }) => {
                                    // Find members who are in both the office and the room
                                    let office_members: HashSet<&String> =
                                        office.members.iter().collect();
                                    let room_members: HashSet<&String> =
                                        room.members.iter().collect();
                                    let common_members = office_members.intersection(&room_members);

                                    for member_id in common_members {
                                        if let Some(user) = tx.get_user(member_id) {
                                            members.push(user.clone());
                                        }
                                    }
                                }
                                _ => return Err(NetworkError::msg("Room not found")),
                            }
                        }
                        _ => return Err(NetworkError::msg("Office not found")),
                    }
                }
                (None, None) => {
                    // Get all members
                    for user in tx.get_all_users().values() {
                        members.push(user.clone());
                    }
                }
            }

            Ok(members)
        })
    }
}
