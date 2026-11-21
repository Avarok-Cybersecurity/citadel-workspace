//! The agent as `main.rs` builds it, and a window's requests to it, for p2p_kex_setup_tests.rs.

use super::super::*;
use crate::identity_setup::{applied, identity_config};
use citadel_internal_service::SERVER_RECONNECT;
use citadel_internal_service_connector::connector::{InternalServiceConnector, WrappedStream};
use citadel_internal_service_connector::io_interface::tcp::TcpIOInterface;
pub(super) use citadel_internal_service_test_common as common;
use citadel_internal_service_types::{
    IdentityDiscovery, IdentityOutcome, InternalServiceRequest, InternalServiceResponse,
    PeerIdentityMark,
};
use citadel_sdk::prelude::{NodeBuilder, NodeType, StackedRatchet};
use common::node_settings::TestNode;
use futures::StreamExt;
use std::net::SocketAddr;
use std::time::Duration;
use uuid::Uuid;

pub(super) type Stream = WrappedStream<TcpIOInterface>;
pub(super) type Sink = citadel_internal_service_connector::connector::WrappedSink<TcpIOInterface>;

pub(super) struct Window {
    pub(super) sink: Sink,
    pub(super) stream: Stream,
    pub(super) cid: u64,
}

/// An agent built as the binary builds one, keeping its accounts, identity and pins in `data`.
pub(super) async fn agent(data: &std::path::Path) -> SocketAddr {
    let backend = BackendType::Filesystem(data.to_string_lossy().into_owned());
    let bind: SocketAddr = format!("127.0.0.1:{}", common::get_free_port())
        .parse()
        .unwrap();
    let service = CitadelWorkspaceService::<_, StackedRatchet>::new_tcp(
        bind,
        SERVER_RECONNECT,
        common::test_transfers(),
        common::TEST_SERVER_CERTIFICATE,
    )
    .await
    .unwrap();
    let kex = kex_identity(&service, &backend).await.unwrap();
    // Not under test: the shipped launchers' value is the operators' choice.
    let idle = Duration::from_secs(900);
    let service = applied(service, identity_config(idle, &backend).unwrap());
    let node = NodeBuilder::<StackedRatchet>::default()
        .with_stun_servers(citadel_sdk::test_common::LOCALHOST_STUN_SERVERS)
        .with_node_type(NodeType::Peer)
        .with_backend(backend)
        .with_insecure_skip_cert_verification()
        .with_p2p_kex_identity(kex)
        .as_test_agent(&service)
        .build(service)
        .unwrap();
    tokio::spawn(node);
    bind
}

pub(super) async fn open(agent: SocketAddr) -> (Sink, Stream) {
    loop {
        if let Ok(connector) = InternalServiceConnector::connect(agent).await {
            return connector.split();
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

pub(super) async fn expect<T>(
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

pub(super) async fn send(sink: &mut Sink, request: InternalServiceRequest) {
    common::send(sink, request).await.unwrap();
}

/// Creates the agent's identity; its 16-character fingerprint, grouped as windows show it.
pub(super) async fn create_identity(sink: &mut Sink, stream: &mut Stream) -> String {
    let request_id = Uuid::new_v4();
    let unlock_password = b"a long unlock passphrase".to_vec().into();
    send(
        sink,
        InternalServiceRequest::IdentityCreate {
            request_id,
            unlock_password,
        },
    )
    .await;
    let id_fp = expect(stream, |r| match r {
        InternalServiceResponse::IdentitySuccess(s) if s.request_id == Some(request_id) => {
            match s.outcome {
                IdentityOutcome::Created { id_fp, .. } => Some(id_fp),
                other => panic!("{other:?}"),
            }
        }
        _ => None,
    })
    .await;
    let groups: Vec<&str> = (0..id_fp.len())
        .step_by(4)
        .map(|at| &id_fp[at..at + 4])
        .collect();
    groups.join("-")
}

pub(super) fn register_identity(
    server: &str,
    server_fp: &str,
    handle: &str,
) -> (Uuid, InternalServiceRequest) {
    let request_id = Uuid::new_v4();
    let request = InternalServiceRequest::RegisterIdentity {
        request_id,
        server_addr: server.to_string(),
        handle: handle.to_string(),
        full_name: "P2P Wiring".to_string(),
        discovery: IdentityDiscovery::Pinned {
            server_fp: server_fp.to_string(),
        },
        session_security_settings: citadel_sdk::prelude::default_session_security_settings(),
        server_password: None,
        admission_token: None,
    };
    (request_id, request)
}

pub(super) async fn signed_in(
    mut sink: Sink,
    mut stream: Stream,
    request_id: Uuid,
    request: InternalServiceRequest,
) -> Window {
    let request_debug = format!("{request:?}");
    send(&mut sink, request).await;
    let request = request_debug;
    let cid = expect(&mut stream, |r| match r {
        InternalServiceResponse::ConnectSuccess(s) if s.request_id == Some(request_id) => {
            Some(s.cid)
        }
        InternalServiceResponse::ConnectFailure(f) if f.request_id == Some(request_id) => {
            panic!("{request:?}: {}", f.message)
        }
        InternalServiceResponse::RegisterFailure(f) if f.request_id == Some(request_id) => {
            panic!("{request:?}: {}", f.message)
        }
        InternalServiceResponse::IdentityFailure(f) if f.request_id == Some(request_id) => {
            panic!("{request:?}: {}", f.message)
        }
        _ => None,
    })
    .await;
    Window { sink, stream, cid }
}

/// `a` and `b` register as peers, `a` dials and `b` accepts as a window does; each end's mark.
pub(super) async fn link(a: &mut Window, b: &mut Window) -> [PeerIdentityMark; 2] {
    let (a_cid, b_cid) = (a.cid, b.cid);
    for (from, to) in [(&mut *a, b_cid), (&mut *b, a_cid)] {
        let request = InternalServiceRequest::PeerRegister {
            request_id: Uuid::new_v4(),
            cid: from.cid,
            peer_cid: to,
            session_security_settings: citadel_sdk::prelude::default_session_security_settings(),
            connect_after_register: false,
            peer_session_password: None,
        };
        send(&mut from.sink, request).await;
    }
    for end in [&mut *a, &mut *b] {
        expect(&mut end.stream, |r| {
            matches!(r, InternalServiceResponse::PeerRegisterSuccess(_)).then_some(())
        })
        .await;
    }
    let dial = InternalServiceRequest::PeerConnect {
        request_id: Uuid::new_v4(),
        cid: a.cid,
        peer_cid: b.cid,
        udp_mode: Default::default(),
        session_security_settings: citadel_sdk::prelude::default_session_security_settings(),
        peer_session_password: None,
        turn: None,
    };
    send(&mut a.sink, dial).await;
    expect(&mut b.stream, |r| {
        matches!(r, InternalServiceResponse::PeerConnectNotification(_)).then_some(())
    })
    .await;
    let accept = InternalServiceRequest::PeerConnectAccept {
        request_id: Uuid::new_v4(),
        cid: b.cid,
        peer_cid: a.cid,
        accept: true,
        udp_mode: Default::default(),
        session_security_settings: citadel_sdk::prelude::default_session_security_settings(),
        peer_session_password: None,
        turn: None,
    };
    send(&mut b.sink, accept).await;
    let mark = |r: InternalServiceResponse| match r {
        InternalServiceResponse::PeerConnectSuccess(s) => Some(s.peer_identity),
        InternalServiceResponse::PeerConnectFailure(f) => panic!("{}", f.message),
        _ => None,
    };
    [
        expect(&mut a.stream, mark).await,
        expect(&mut b.stream, mark).await,
    ]
}

pub(super) fn verified(fingerprint: &str) -> PeerIdentityMark {
    PeerIdentityMark::Verified {
        fingerprint: fingerprint.to_string(),
    }
}
