use crate::handlers::domain::DomainEntity;
use citadel_workspace_types::structs::{Domain, Office, Room};
use uuid::Uuid;

/// Implement DomainEntity for Office
impl DomainEntity for Office {
    fn id(&self) -> String {
        self.id.clone()
    }

    fn name(&self) -> String {
        self.name.clone()
    }

    fn description(&self) -> String {
        self.description.clone()
    }

    fn owner_id(&self) -> String {
        self.owner_id.clone()
    }

    fn domain_id(&self) -> String {
        self.id.clone()
    }

    fn into_domain(self) -> Domain {
        Domain::Office { office: self }
    }

    fn create(id: String, _parent_id: Option<String>, name: &str, description: &str) -> Self {
        let office_id = if id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            id
        };

        Office {
            id: office_id,
            workspace_id: _parent_id.unwrap_or_default(),
            name: name.to_string(),
            description: description.to_string(),
            owner_id: "".to_string(),
            members: vec![],
            // denylist: Vec::new(),
            rooms: Vec::new(),
            mdx_content: String::new(),
            metadata: Vec::new(),
        }
    }

    fn from_domain(domain: Domain) -> Option<Self> {
        match domain {
            Domain::Office { office } => Some(office),
            _ => None,
        }
    }
}

/// Implement DomainEntity for Room
impl DomainEntity for Room {
    fn id(&self) -> String {
        self.id.clone()
    }

    fn name(&self) -> String {
        self.name.clone()
    }

    fn description(&self) -> String {
        self.description.clone()
    }

    fn owner_id(&self) -> String {
        self.owner_id.clone()
    }

    fn domain_id(&self) -> String {
        self.office_id.clone()
    }

    fn into_domain(self) -> Domain {
        Domain::Room { room: self }
    }

    fn create(id: String, parent_id: Option<String>, name: &str, description: &str) -> Self {
        let room_id = if id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            id
        };

        let office_id = parent_id.unwrap_or_default();

        Room {
            id: room_id,
            name: name.to_string(),
            description: description.to_string(),
            office_id,
            owner_id: "".to_string(),
            members: vec![],
            // denylist: Vec::new(),
            mdx_content: String::new(),
            metadata: Vec::new(),
        }
    }

    fn from_domain(domain: Domain) -> Option<Self> {
        match domain {
            Domain::Room { room } => Some(room),
            _ => None,
        }
    }
}
