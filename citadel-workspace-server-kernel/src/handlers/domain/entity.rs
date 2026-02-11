use crate::handlers::domain::DomainEntity;
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Workspace};
use uuid::Uuid;

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
        }
    }

    fn try_from_workspace(workspace: Workspace) -> Result<Self, NetworkError> {
        Ok(workspace)
    }
}
