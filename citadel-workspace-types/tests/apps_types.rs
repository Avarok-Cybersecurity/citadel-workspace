//! The apps wire types: capability names, scope keys, audience and request shapes.

use citadel_workspace_types::apps::{AppAudience, Capability, InstallScope, ScopeKind};
use citadel_workspace_types::apps_protocol::{AppsRequest, IhttpAddress};
use serde_json::json;
use std::collections::HashSet;

/// Fails to compile when a capability is added, as a prompt to add it to `Capability::ALL`.
fn listed(cap: Capability) -> bool {
    use Capability::*;
    match cap {
        Canvas | Ui | Events | Navigate | Log | NodesRead | NodesWrite | MdEdit | FilesRead
        | FilesWrite | ChatRead | ChatSend | MembersList | StorageUser | StorageScope
        | StorageNode | StorageBlob | StorageFiles | StorageLocal | ClipboardRead
        | ClipboardWrite | Notifications | Documents | NetHost | NetHostPrivate | NetServer
        | IhttpServe | IhttpCall | IhttpP2pServe | IhttpP2pCall | GroupTopicSubscribe
        | GroupTopicPublish => Capability::ALL.contains(&cap),
    }
}

#[test]
fn every_capability_is_listed_once_with_its_manifest_name() {
    assert!(Capability::ALL.iter().copied().all(listed));
    assert_eq!(Capability::ALL.len(), 32);
    let names: Vec<String> = Capability::ALL
        .iter()
        .map(|c| {
            serde_json::to_value(c)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(
        names.iter().collect::<HashSet<_>>().len(),
        names.len(),
        "a name twice"
    );
    for (cap, name) in [
        (Capability::NodesRead, "nodes.read"),
        (Capability::NetHostPrivate, "net.host.private"),
        (Capability::IhttpCall, "ihttp.call"),
        (Capability::IhttpP2pServe, "ihttp.p2p.serve"),
        (Capability::GroupTopicPublish, "group.topic.publish"),
        (Capability::StorageScope, "storage.scope"),
    ] {
        assert_eq!(serde_json::to_value(cap).unwrap(), json!(name));
    }
    assert!(
        serde_json::from_value::<Capability>(json!("network")).is_err(),
        "R1's network is gone"
    );
    assert!(Capability::ALL
        .iter()
        .filter(|c| citadel_workspace_types::apps::takes_hosts(**c))
        .eq([&Capability::NetHost, &Capability::NetServer]));
}

#[test]
fn scope_keys_name_each_scope_and_the_same_people_in_any_order_alike() {
    assert_eq!(InstallScope::Workspace.scope_key().unwrap(), "workspace");
    assert_eq!(
        InstallScope::Node("n1".into()).scope_key().unwrap(),
        "node:n1"
    );
    assert_eq!(
        InstallScope::NodeTree("n1".into()).scope_key().unwrap(),
        "tree:n1"
    );
    assert_eq!(
        InstallScope::SelfOnly("alice".into()).scope_key().unwrap(),
        "self:alice"
    );
    let users = |names: &[&str]| {
        InstallScope::Users(names.iter().map(|n| n.to_string()).collect())
            .scope_key()
            .unwrap()
    };
    assert_eq!(users(&["alice", "bob"]), users(&["bob", "alice", "bob"]));
    assert_ne!(users(&["alice", "bob"]), users(&["alice"]));
    assert!(
        users(&["alice"]).starts_with("users:") && users(&["alice"]).len() == "users:".len() + 32
    );
    for bad in [
        InstallScope::Node(String::new()),
        InstallScope::Node("a/b".into()),
        InstallScope::NodeTree("x y".into()),
        InstallScope::SelfOnly("a".repeat(129)),
        InstallScope::Users(vec![]),
        InstallScope::Users(vec!["ok".into(), "".into()]),
    ] {
        assert_eq!(bad.scope_key(), None, "{bad:?}");
    }
    assert_eq!(
        InstallScope::Users(vec!["a".into()]).kind(),
        ScopeKind::Users
    );
}

#[test]
fn wire_shapes_are_the_designed_ones() {
    assert_eq!(
        serde_json::to_value(AppAudience::Global {}).unwrap(),
        json!({ "kind": "global" })
    );
    assert_eq!(
        serde_json::to_value(AppAudience::Members {
            usernames: vec!["a".into()]
        })
        .unwrap(),
        json!({ "kind": "members", "usernames": ["a"] })
    );
    assert_eq!(
        serde_json::to_value(ScopeKind::SelfOnly).unwrap(),
        json!("self")
    );
    assert_eq!(
        serde_json::to_value(InstallScope::Node("n".into())).unwrap(),
        json!({ "Node": "n" })
    );
    let request = AppsRequest::IhttpSend {
        from_install_id: "i1".into(),
        to: IhttpAddress::Scope {
            app_id: "com.acme.kanban".into(),
            scope_key: "node:n".into(),
        },
        frame: vec![1, 2, 3],
    };
    let text = serde_json::to_string(&request).unwrap();
    assert_eq!(serde_json::from_str::<AppsRequest>(&text).unwrap(), request);
    // A logged request prints the frame's length, never its bytes.
    let printed = format!("{request:?}");
    assert!(!printed.contains("[1, 2, 3]"), "{printed}");
}
