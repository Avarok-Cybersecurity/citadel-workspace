use crate::handlers::domain::DomainEntity;
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Office, Room, Workspace};
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

    fn entity_type() -> &'static str {
        "office"
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

    fn try_from_workspace(_workspace: Workspace) -> Result<Self, NetworkError> {
        Err(NetworkError::msg("Cannot convert Workspace to Office"))
    }

    fn try_from_office(office: Office) -> Result<Self, NetworkError> {
        Ok(office)
    }

    fn try_from_room(_room: Room) -> Result<Self, NetworkError> {
        Err(NetworkError::msg("Cannot convert Room to Office"))
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

    fn entity_type() -> &'static str {
        "room"
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

    fn try_from_workspace(_workspace: Workspace) -> Result<Self, NetworkError> {
        Err(NetworkError::msg("Cannot convert Workspace to Room"))
    }

    fn try_from_office(_office: Office) -> Result<Self, NetworkError> {
        Err(NetworkError::msg("Cannot convert Office to Room"))
    }

    fn try_from_room(room: Room) -> Result<Self, NetworkError> {
        Ok(room)
    }
}

/// Implement DomainEntity for Workspace
impl DomainEntity for Workspace {
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

    fn entity_type() -> &'static str {
        "workspace"
    }

    fn into_domain(self) -> Domain {
        Domain::Workspace { workspace: self }
    }

    fn create(id: String, _parent_id: Option<String>, name: &str, description: &str) -> Self {
        let workspace_id = if id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            id
        };

        Workspace {
            id: workspace_id,
            name: name.to_string(),
            description: description.to_string(),
            owner_id: "".to_string(),
            members: vec![],
            offices: vec![],
            metadata: Vec::new(),
        }
    }

    fn from_domain(domain: Domain) -> Option<Self> {
        match domain {
            Domain::Workspace { workspace } => Some(workspace),
            _ => None,
        }
    }

    fn try_from_workspace(workspace: Workspace) -> Result<Self, NetworkError> {
        Ok(workspace)
    }

    fn try_from_office(_office: Office) -> Result<Self, NetworkError> {
        Err(NetworkError::msg("Cannot convert Office to Workspace"))
    }

    fn try_from_room(_room: Room) -> Result<Self, NetworkError> {
        Err(NetworkError::msg("Cannot convert Room to Workspace"))
    }
}
