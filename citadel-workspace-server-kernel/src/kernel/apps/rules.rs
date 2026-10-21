//! Which permission each capability and each apps action takes, and what an install may do now.
//!
//! Pure. The installer's and the acting member's permissions arrive as predicates the handler
//! builds from the role table and node grants, read at the time of the call: a role demotion
//! therefore shrinks what every install that member made can do, at once.

use citadel_workspace_types::apps::{Capability, InstallScope, ScopeKind};
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_manifest::CapabilityRequest;
use citadel_workspace_types::structs::Permission;
use std::collections::BTreeSet;

/// The workspace permission an installer must hold to grant `cap`, at install and at every call
/// after it.
pub fn required_installer_permission(cap: Capability) -> Permission {
    use Capability::*;
    match cap {
        // Intrinsic: installing at all is enough. `documents` is gated by the publisher key
        // instead (`first_party_only`).
        Canvas | Ui | Events | Navigate | Log | Documents => Permission::AppInstall,
        NodesRead => Permission::AppInstallAllowNodeRead,
        NodesWrite => Permission::AppInstallAllowNodeWrite,
        MdEdit => Permission::AppInstallAllowMdEdit,
        FilesRead | FilesWrite => Permission::AppInstallAllowFiles,
        ChatRead | ChatSend => Permission::AppInstallAllowChat,
        MembersList | MembersPresence => Permission::AppInstallAllowMembers,
        StorageUser | StorageScope | StorageNode | StorageBlob | StorageLocal => {
            Permission::AppInstallAllowStorage
        }
        ClipboardRead | ClipboardWrite => Permission::AppInstallAllowClipboard,
        Notifications => Permission::AppInstallAllowNotifications,
        NetHost => Permission::AppInstallAllowHostNetwork,
        NetHostPrivate => Permission::AppInstallAllowPrivateNetwork,
        NetServer => Permission::AppInstallAllowServerNetwork,
        IhttpServe => Permission::AppInstallAllowInternalServe,
        IhttpCall => Permission::AppInstallAllowInternalCall,
    }
}

/// Granted only to an app signed by the first-party publisher key.
pub fn first_party_only(cap: Capability) -> bool {
    matches!(cap, Capability::Documents)
}

/// What the acting member must hold on the call's target for `cap` to be usable at all. An
/// operation can need more (`nodes.write` creating takes `CreateNode`, moving takes
/// `EditTreeStructure`; a shared write takes `EditContent`), which the call's own check adds.
pub fn acting_user_requirement(cap: Capability) -> &'static [Permission] {
    use Capability::*;
    match cap {
        Canvas | Ui | Events | Navigate | Log | NodesRead | StorageUser | StorageScope
        | StorageNode | StorageBlob | StorageLocal => &[Permission::ViewContent],
        NodesWrite => &[Permission::CreateNode, Permission::EditTreeStructure],
        MdEdit | Documents => &[Permission::EditMdx],
        FilesRead => &[Permission::DownloadFiles],
        FilesWrite => &[Permission::UploadFiles],
        ChatRead => &[Permission::ReadMessages],
        ChatSend => &[Permission::SendMessages],
        MembersList | MembersPresence => &[Permission::ViewMembers],
        ClipboardRead | ClipboardWrite | Notifications | NetHost | NetHostPrivate | NetServer
        | IhttpServe | IhttpCall => &[],
    }
}

/// The permission installing at `scope` takes. Installing for anyone but oneself also needs
/// authority over the scope's node, which the handler checks there.
pub fn install_permission(scope: &InstallScope, installer: &str) -> Permission {
    match scope {
        InstallScope::SelfOnly(user) if user == installer => Permission::AppInstall,
        _ => Permission::AppInstallScoped,
    }
}

/// Apps actions that take fixed workspace permissions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppsAction {
    /// List an app in this workspace's registry.
    Publish,
    /// Uninstall or suspend someone else's install, roll back, read the audit log.
    Manage,
    /// Write a document's required-apps header (with `EditMdx` on that node).
    WriteMdHeader,
}

pub fn action_permissions(action: AppsAction) -> &'static [Permission] {
    match action {
        AppsAction::Publish => &[Permission::AppPublish],
        AppsAction::Manage => &[Permission::AppManage],
        AppsAction::WriteMdHeader => &[Permission::AppManage, Permission::EditMdx],
    }
}

/// Whether `installer` may install at `scope` an app supporting `supported` scopes.
pub fn may_install_at(
    scope: &InstallScope,
    supported: &[ScopeKind],
    installer: &str,
    installer_holds: &dyn Fn(Permission) -> bool,
) -> Result<(), AppsRefusal> {
    if !supported.contains(&scope.kind()) || scope.scope_key().is_none() {
        return Err(AppsRefusal::ScopeNotSupported);
    }
    let needed = install_permission(scope, installer);
    if !installer_holds(needed) {
        return Err(AppsRefusal::PermissionRequired(needed));
    }
    Ok(())
}

/// Whether `installer` may grant exactly `granted` of what `requests` asks: nothing it does not
/// ask, everything it does not mark optional, each with the installer's `AppInstallAllow*`,
/// first-party capabilities only to the first-party key, and `net.host.private` only beside
/// `net.host`.
pub fn check_grant(
    requests: &[CapabilityRequest],
    granted: &BTreeSet<Capability>,
    installer_holds: &dyn Fn(Permission) -> bool,
    first_party_key: bool,
) -> Result<(), AppsRefusal> {
    for cap in granted {
        if !requests.iter().any(|r| r.cap == *cap) {
            return Err(AppsRefusal::NotRequested(*cap));
        }
        if first_party_only(*cap) && !first_party_key {
            return Err(AppsRefusal::FirstPartyOnly(*cap));
        }
        if !installer_holds(required_installer_permission(*cap)) {
            return Err(AppsRefusal::CapabilityNotGrantable(*cap));
        }
    }
    if let Some(left_out) = requests
        .iter()
        .find(|r| !r.optional && !granted.contains(&r.cap))
    {
        return Err(AppsRefusal::RequiredCapabilityLeftOut(left_out.cap));
    }
    if granted.contains(&Capability::NetHostPrivate) && !granted.contains(&Capability::NetHost) {
        return Err(AppsRefusal::RequiredCapabilityLeftOut(Capability::NetHost));
    }
    Ok(())
}

/// What an install may do for this call: what it was granted, that the installer may still
/// grant, that the acting member's own permissions on the target allow, and nothing at all when
/// the target is outside the install's reach.
pub fn effective_capabilities(
    granted: &BTreeSet<Capability>,
    installer_holds: &dyn Fn(Permission) -> bool,
    acting_user_holds: &dyn Fn(Permission) -> bool,
    within_scope_reach: bool,
) -> BTreeSet<Capability> {
    if !within_scope_reach {
        return BTreeSet::new();
    }
    granted
        .iter()
        .copied()
        .filter(|cap| installer_holds(required_installer_permission(*cap)))
        .filter(|cap| {
            let needs = acting_user_requirement(*cap);
            needs.is_empty() || needs.iter().any(|p| acting_user_holds(*p))
        })
        .collect()
}

/// `cap` for this call, or the uniform refusal.
pub fn require_capability(
    effective: &BTreeSet<Capability>,
    cap: Capability,
) -> Result<(), AppsRefusal> {
    if effective.contains(&cap) {
        Ok(())
    } else {
        Err(AppsRefusal::Ungranted(cap))
    }
}
