use super::trust_scope::*;
use citadel_workspace_types::messaging_trust::WORKSPACE_ROOT_ID;
use citadel_workspace_types::messaging_trust::{
    MessagingTrustPolicy, DEFAULT_MESSAGING_TRUST_POLICY, MESSAGING_TRUST_POLICY_KEY,
};
use citadel_workspace_types::structs::{DomainNode, MetadataValue, User, UserRole};
use citadel_workspace_types::structs::{DomainPermissions, NodeEntityType};
use std::collections::HashMap;

/// workspace-root ─┬─ eng ── backend
///                 └─ sales
fn tree() -> HashMap<String, DomainNode> {
    let node = |id: &str, parent: &str, members: &[&str]| DomainNode {
        id: id.to_string(),
        parent_id: Some(parent.to_string()),
        entity_type: NodeEntityType::Child("Level".to_string()),
        depth: 1,
        name: id.to_string(),
        description: String::new(),
        owner_id: "owner".to_string(),
        members: members.iter().map(|m| m.to_string()).collect(),
        children: vec![],
        mdx_content: String::new(),
        mdx_content_hash: None,
        rules: None,
        chat_enabled: false,
        chat_channel_id: None,
        default_permissions: DomainPermissions::default(),
        metadata: vec![],
        allowed_child_types: None,
        is_default: false,
        created_at: 0,
        updated_at: 0,
    };
    [
        node("eng", WORKSPACE_ROOT_ID, &["eve"]),
        node("backend", "eng", &["bob"]),
        node("sales", WORKSPACE_ROOT_ID, &["sam"]),
    ]
    .into_iter()
    .map(|n| (n.id.clone(), n))
    .collect()
}

fn user(id: &str, role: UserRole) -> User {
    User::new(id.to_string(), id.to_string(), role)
}

fn policy_on(id: &str) -> MessagingTrustPolicy {
    MessagingTrustPolicy::NodeLevelTrusted {
        node_id: id.to_string(),
    }
}

#[test]
fn a_node_holds_its_own_members_and_those_below_but_not_those_above() {
    let nodes = tree();
    let workspace = ["wes".to_string()];
    assert!(in_subtree(&nodes, "eng", &[], "eve"));
    assert!(in_subtree(&nodes, "eng", &[], "bob"));
    assert!(!in_subtree(&nodes, "eng", &[], "sam"));
    assert!(!in_subtree(&nodes, "eng", &[], "wes"));
    assert!(in_subtree(&nodes, WORKSPACE_ROOT_ID, &workspace, "wes"));
    assert!(in_subtree(&nodes, WORKSPACE_ROOT_ID, &workspace, "sam"));
}

#[test]
fn a_missing_key_is_the_default_and_an_unreadable_one_is_strict() {
    assert_eq!(workspace_policy(b""), DEFAULT_MESSAGING_TRUST_POLICY);
    assert_eq!(
        workspace_policy(br#"{"initialized":true}"#),
        MessagingTrustPolicy::AllTrusted
    );
    assert_eq!(
        workspace_policy(br#"{"messaging_trust_policy":{"Nope":1}}"#),
        MessagingTrustPolicy::Strict
    );
    assert_eq!(workspace_policy(b"not json"), MessagingTrustPolicy::Strict);
    assert_eq!(
        workspace_policy(br#"{"messaging_trust_policy":{"NodeLevelTrusted":{"node_id":"eng"}}}"#),
        policy_on("eng")
    );
}

#[test]
fn a_personal_policy_round_trips_and_clears() {
    let mut eve = user("eve", UserRole::Member);
    assert_eq!(personal_policy(&eve), None);
    set_personal_policy(&mut eve, Some(&policy_on("eng"))).expect("encodes");
    assert_eq!(personal_policy(&eve), Some(policy_on("eng")));
    set_personal_policy(&mut eve, None).expect("clears");
    assert_eq!(personal_policy(&eve), None);
    eve.metadata.insert(
        MESSAGING_TRUST_POLICY_KEY.to_string(),
        MetadataValue::Boolean(true),
    );
    assert_eq!(personal_policy(&eve), Some(MessagingTrustPolicy::Strict));
    eve.metadata.insert(
        MESSAGING_TRUST_POLICY_KEY.to_string(),
        MetadataValue::String("not a policy".to_string()),
    );
    assert_eq!(personal_policy(&eve), Some(MessagingTrustPolicy::Strict));
}

#[test]
fn trust_needs_both_inside_the_owners_effective_root() {
    let nodes = tree();
    let eve = user("eve", UserRole::Member);
    let bob = user("bob", UserRole::Member);
    let sam = user("sam", UserRole::Member);
    let eng = policy_on("eng");
    assert!(trusts(&nodes, &eng, WORKSPACE_ROOT_ID, &[], &eve, &bob));
    assert!(!trusts(&nodes, &eng, WORKSPACE_ROOT_ID, &[], &eve, &sam));
    assert!(!trusts(&nodes, &eng, WORKSPACE_ROOT_ID, &[], &sam, &eve));
}

#[test]
fn a_banned_account_is_never_trusted() {
    let nodes = tree();
    let all = MessagingTrustPolicy::AllTrusted;
    let members = ["eve".to_string(), "mal".to_string()];
    let eve = user("eve", UserRole::Member);
    let mal = user("mal", UserRole::Banned);
    assert!(!trusts(
        &nodes,
        &all,
        WORKSPACE_ROOT_ID,
        &members,
        &eve,
        &mal
    ));
    assert!(!trusts(
        &nodes,
        &all,
        WORKSPACE_ROOT_ID,
        &members,
        &mal,
        &eve
    ));
}
