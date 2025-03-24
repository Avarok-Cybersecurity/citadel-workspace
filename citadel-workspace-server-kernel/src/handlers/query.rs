use crate::kernel::WorkspaceServerKernel;
use crate::structs::{Domain, User};
use citadel_sdk::prelude::Ratchet;

// Query handlers - functions for retrieving workspace information

#[allow(dead_code)]
impl<R: Ratchet> WorkspaceServerKernel<R> {
    // List members in an office or room
    pub fn list_members(
        &self,
        office_id: Option<&String>,
        room_id: Option<&String>,
    ) -> Result<Vec<User>, String> {
        let users = self.users.read().unwrap();
        let domains = self.domains.read().unwrap();
        let mut members = Vec::new();

        match (office_id, room_id) {
            (Some(office_id), None) => {
                // Get members of an office
                match domains.get(office_id) {
                    Some(Domain::Office { office }) => {
                        for member_id in &office.members {
                            if let Some(user) = users.get(member_id) {
                                members.push(user.clone());
                            }
                        }
                    }
                    _ => return Err("Office not found".to_string()),
                }
            }
            (None, Some(room_id)) => {
                // Get members of a room
                match domains.get(room_id) {
                    Some(Domain::Room { room }) => {
                        for member_id in &room.members {
                            if let Some(user) = users.get(member_id) {
                                members.push(user.clone());
                            }
                        }
                    }
                    _ => return Err("Room not found".to_string()),
                }
            }
            (None, None) => {
                // Get all users
                for user in users.values() {
                    members.push(user.clone());
                }
            }
            _ => return Err("Cannot specify both office and room".to_string()),
        }

        Ok(members)
    }
}
