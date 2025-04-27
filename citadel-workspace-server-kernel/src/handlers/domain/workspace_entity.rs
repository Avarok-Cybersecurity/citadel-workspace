use crate::handlers::domain::DomainEntity;
use citadel_workspace_types::structs::{Domain, Workspace};

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

    fn into_domain(self) -> Domain {
        Domain::Workspace { workspace: self }
    }

    fn create(_id: String, _parent_id: Option<String>, name: &str, description: &str) -> Self {
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        Workspace {
            id: workspace_id,
            name: name.to_string(),
            description: description.to_string(),
            owner_id: "".to_string(), // Will be set after creation
            members: Vec::new(),
            offices: Vec::new(),
            metadata: Vec::new(),
        }
    }

    fn from_domain(domain: Domain) -> Option<Self> {
        match domain {
            Domain::Workspace { workspace } => Some(workspace),
            _ => None,
        }
    }
}
