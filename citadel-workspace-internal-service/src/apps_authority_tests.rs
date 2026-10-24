//! The codec against the real workspace types: the question is the kernel's `HostNetGrant`
//! request, its answer is read back as the grant, and nothing else is mistaken for one.

use super::*;
use citadel_workspace_types::apps_install::HostNetGrant;
use citadel_workspace_types::telemetry::TelemetryResponse;

fn response(apps: AppsResponse) -> Vec<u8> {
    let payload =
        WorkspaceProtocolPayload::Response(Box::new(WorkspaceProtocolResponse::Apps(apps)));
    serde_json::to_vec(&payload).unwrap()
}

#[test]
fn the_question_is_the_kernels_host_net_grant_request_with_a_plain_number_tag() {
    let frame = WorkspaceHostNetAuthority
        .grant_query("inst-1", 7)
        .expect("encodes");
    let decoded: WorkspaceProtocolPayload = serde_json::from_slice(&frame).unwrap();
    let WorkspaceProtocolPayload::Request(WorkspaceProtocolRequest::Apps(
        AppsRequest::HostNetGrant { install_id, tag },
    )) = decoded
    else {
        panic!(
            "not a HostNetGrant request: {}",
            String::from_utf8_lossy(&frame)
        )
    };
    assert_eq!((install_id.as_str(), tag), ("inst-1", 7));
    let text = String::from_utf8(frame).unwrap();
    assert!(text.contains("\"tag\":7"), "{text}");
}

#[test]
fn an_answer_is_read_as_the_grant_and_a_refusal_as_none() {
    let granted = response(AppsResponse::HostNetGrant {
        install_id: "inst-1".into(),
        tag: 9,
        grant: Some(HostNetGrant {
            app_id: "com.acme.kanban".into(),
            hosts: vec!["api.acme.com".into()],
            private: true,
        }),
    });
    assert_eq!(
        WorkspaceHostNetAuthority.classify(&granted),
        AuthoritySignal::Grant {
            install_id: "inst-1".into(),
            tag: 9,
            grant: Some(KernelGrant {
                app_id: "com.acme.kanban".into(),
                hosts: vec!["api.acme.com".into()],
                private: true,
            }),
        }
    );
    let refused = response(AppsResponse::HostNetGrant {
        install_id: "inst-1".into(),
        tag: 10,
        grant: None,
    });
    assert_eq!(
        WorkspaceHostNetAuthority.classify(&refused),
        AuthoritySignal::Grant {
            install_id: "inst-1".into(),
            tag: 10,
            grant: None,
        }
    );
}

#[test]
fn a_change_to_the_members_installs_is_read_as_one() {
    for apps in [
        AppsResponse::InstallsChanged,
        AppsResponse::Uninstalled {
            install_id: "inst-1".into(),
        },
        AppsResponse::DisabledForMe {
            install_id: "inst-1".into(),
            disabled: true,
        },
    ] {
        assert_eq!(
            WorkspaceHostNetAuthority.classify(&response(apps.clone())),
            AuthoritySignal::InstallsChanged,
            "{apps:?}"
        );
    }
}

#[test]
fn other_traffic_is_unrelated() {
    // The control: the classifications above are the answers', not any frame's.
    let telemetry = serde_json::to_vec(&WorkspaceProtocolPayload::Response(Box::new(
        WorkspaceProtocolResponse::Telemetry(TelemetryResponse::TurnUsageRecorded),
    )))
    .unwrap();
    assert_eq!(
        WorkspaceHostNetAuthority.classify(&telemetry),
        AuthoritySignal::Unrelated
    );
    // Past the prefilter (it names a key as a value), and still not an answer or a change.
    let up_to_date = response(AppsResponse::UpToDate {
        install_id: "Installed".into(),
    });
    assert!(names_a_key(&up_to_date));
    assert_eq!(
        WorkspaceHostNetAuthority.classify(&up_to_date),
        AuthoritySignal::Unrelated
    );
    assert_eq!(
        WorkspaceHostNetAuthority.classify(b"not json \"HostNetGrant\""),
        AuthoritySignal::Unrelated
    );
}
