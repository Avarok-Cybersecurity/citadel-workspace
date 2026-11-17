//! The identity's settings, and the identity as this binary configures it, end to end: an agent
//! built with `applied` registers an identity account on the shipped server, in process, and
//! the server's `ServerIdentity` answer comes back through the workspace codec and proves the
//! pinned key.
//!
//! Control: drop the `with_identity` call from `applied` → `IdentityCreate` is refused as
//! `NotConfigured` and `a_kernel_s_answer_verifies_the_pinned_server` fails.

use super::*;
use citadel_internal_service_connector::connector::InternalServiceConnector;
use citadel_internal_service_test_common as common;
use citadel_internal_service_types::{
    IdentityDiscovery, IdentityOutcome, InternalServiceRequest, InternalServiceResponse,
};
use citadel_sdk::prelude::{NodeBuilder, NodeType, StackedRatchet};
use citadel_workspace_server_kernel_test_common::production_server::start_server_named_localhost;
use futures::StreamExt;
use uuid::Uuid;

const NONE: (Option<&str>, Option<&str>) = (None, None);

fn all(secs: &str) -> Result<IdentityTimings, String> {
    IdentityTimings::resolve((None, Some(secs)), (None, Some(secs)), (None, Some(secs)))
}

#[test]
fn each_missing_timing_is_named_with_its_flag_and_variable() {
    for (missing, timing) in [
        (0, &UNLOCK_IDLE),
        (1, &CHALLENGE_TIMEOUT),
        (2, &FETCH_TIMEOUT),
    ] {
        let mut given = [(None, Some("5")); 3];
        given[missing] = NONE;
        let error = IdentityTimings::resolve(given[0], given[1], given[2]).unwrap_err();
        assert!(error.contains(timing.flag), "{error}");
        assert!(error.contains(timing.env), "{error}");
    }
}

#[test]
fn the_variable_wins_and_an_empty_one_is_unset() {
    let timings = IdentityTimings::resolve(
        (Some("7"), Some("1")),
        (Some(""), Some("2")),
        (None, Some("3")),
    )
    .unwrap();
    assert_eq!(timings.unlock_idle, Duration::from_secs(7));
    assert_eq!(timings.challenge_timeout, Duration::from_secs(2));
    assert_eq!(timings.fetch_timeout, Duration::from_secs(3));
    assert!(
        IdentityTimings::resolve((Some(""), Some("")), (None, Some("1")), (None, Some("1")))
            .is_err()
    );
}

#[test]
fn zero_and_non_numbers_are_refused() {
    // Zero would lock the identity at once, or give up on every server before it could answer.
    for bad in ["0", "-1", "10s", "1.5", "nine"] {
        let error = all(bad).unwrap_err();
        assert!(error.contains("whole number of seconds"), "{bad}: {error}");
    }
}

#[tokio::test]
async fn a_filesystem_backend_keeps_the_identity_under_its_data_dir() {
    let dir = tempfile::tempdir().unwrap();
    let backend = BackendType::Filesystem(dir.path().to_string_lossy().into_owned());
    store_for(&backend)
        .unwrap()
        .save(b"record".to_vec())
        .await
        .unwrap();
    let kept = std::fs::read(dir.path().join(STORE_DIR).join("identity.json")).unwrap();
    assert_eq!(kept, b"record");
}

type Stream = citadel_internal_service_connector::connector::WrappedStream<
    citadel_internal_service_connector::io_interface::tcp::TcpIOInterface,
>;

async fn expect<T>(
    stream: &mut Stream,
    mut pick: impl FnMut(InternalServiceResponse) -> Option<T>,
) -> T {
    loop {
        let response = tokio::time::timeout(Duration::from_secs(60), stream.next())
            .await
            .expect("the agent answered within a minute")
            .expect("the agent closed the connection");
        if let Some(found) = pick(response) {
            return found;
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_kernel_s_answer_verifies_the_pinned_server() {
    common::setup_log();
    let (server, server_fp) = start_server_named_localhost().await;

    let data = tempfile::tempdir().unwrap();
    let backend = BackendType::Filesystem(data.path().to_string_lossy().into_owned());
    // Generous and not under test: the shipped launchers' values are the operators' choice.
    let timings = all("20").unwrap();
    let bind: std::net::SocketAddr = format!("127.0.0.1:{}", common::get_free_port())
        .parse()
        .unwrap();
    let service = CitadelWorkspaceService::<_, StackedRatchet>::new_tcp(
        bind,
        citadel_internal_service::SERVER_RECONNECT,
        common::test_transfers(),
    )
    .await
    .unwrap();
    let service = applied(service, identity_config(&timings, &backend).unwrap());
    let node = NodeBuilder::<StackedRatchet>::default()
        .with_stun_servers(citadel_sdk::test_common::LOCALHOST_STUN_SERVERS)
        .with_node_type(NodeType::Peer)
        .with_backend(backend)
        .with_insecure_skip_cert_verification()
        .build(service)
        .unwrap();
    let _node = tokio::spawn(node);
    let (mut sink, mut stream) = loop {
        if let Ok(connector) = InternalServiceConnector::connect(bind).await {
            break connector.split();
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    };

    let request_id = Uuid::new_v4();
    let create = InternalServiceRequest::IdentityCreate {
        request_id,
        unlock_password: b"a long unlock passphrase".to_vec().into(),
    };
    common::send(&mut sink, create).await.unwrap();
    let created = expect(&mut stream, |r| match r {
        InternalServiceResponse::IdentitySuccess(s) if s.request_id == Some(request_id) => {
            Some(Ok(s.outcome))
        }
        InternalServiceResponse::IdentityFailure(f) if f.request_id == Some(request_id) => {
            Some(Err(format!("{:?}: {}", f.reason, f.message)))
        }
        _ => None,
    })
    .await
    .expect("the agent holds an identity");
    assert!(
        matches!(created, IdentityOutcome::Created { .. }),
        "{created:?}"
    );
    assert!(
        data.path().join(STORE_DIR).join("identity.json").is_file(),
        "the sealed identity is kept under the data dir"
    );

    let request_id = Uuid::new_v4();
    let register = InternalServiceRequest::RegisterIdentity {
        request_id,
        server_addr: server.clone(),
        handle: "alice".to_string(),
        full_name: "Identity Wiring".to_string(),
        discovery: IdentityDiscovery::Pinned {
            server_fp: server_fp.clone(),
        },
        session_security_settings: Default::default(),
        server_password: None,
        admission_token: None,
    };
    common::send(&mut sink, register).await.unwrap();
    let signed_in = expect(&mut stream, |r| match r {
        InternalServiceResponse::ConnectSuccess(s) if s.request_id == Some(request_id) => {
            Some(Ok(s))
        }
        InternalServiceResponse::ConnectFailure(f) if f.request_id == Some(request_id) => {
            Some(Err(format!("{:?}: {}", f.reason_code, f.message)))
        }
        InternalServiceResponse::RegisterFailure(f) if f.request_id == Some(request_id) => {
            Some(Err(format!("{:?}: {}", f.reason_code, f.message)))
        }
        _ => None,
    })
    .await
    .expect("the identity account signed in");
    let pinned = signed_in.identity.expect("ConnectSuccess carries the pin");
    assert_eq!(pinned.handle, "alice");
    assert_eq!(pinned.canonical_domain, server);
    assert_eq!(pinned.server_fp, server_fp);
    assert!(
        pinned.verified,
        "the kernel's ServerIdentity answer proved the pinned key"
    );
}
