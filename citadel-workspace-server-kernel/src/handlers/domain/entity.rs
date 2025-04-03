use crate::handlers::domain::DomainEntity;
use crate::structs::{Domain, Office, Room};

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
        Office {
            id,
            name: name.to_string(),
            description: description.to_string(),
            owner_id: "".to_string(),
            members: vec![],
            rooms: Vec::new(),
            mdx_content: String::new(),
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
        Room {
            id,
            name: name.to_string(),
            description: description.to_string(),
            owner_id: "".to_string(),
            office_id: parent_id.unwrap_or_default(),
            members: vec![],
            mdx_content: String::new(),
        }
    }

    fn from_domain(domain: Domain) -> Option<Self> {
        match domain {
            Domain::Room { room } => Some(room),
            _ => None,
        }
    }
}
