//! TEST: the host-call half of the shared runtime-wire fixture, each value encoded by the codec
//! the kernel decodes it with: `AppsRequest::Call` payloads (an op's arguments as the guest
//! writes them, and the `HostCall` the page sends), the `HostReply` the kernel answers, the
//! reply the page hands an app for a refused request, and the routes digest.

use super::ihttp_routes::routes_digest;
use citadel_app_sdk_types::calls::*;
use citadel_app_sdk_types::ops::{NetOps, StorageOps};
use citadel_app_sdk_types::{decode, encode, Bytes, HostCall, HostReply, Refused};
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::AppsRefusal;
use serde::Serialize;
use serde_json::{json, Value};

fn call_case<T: Serialize>(name: &str, op: &str, args: &T, call: HostCall) -> Value {
    let call_bytes = encode(&call);
    assert_eq!(decode::<HostCall>(&call_bytes).expect("a HostCall"), call);
    json!({
        "name": name,
        "group": format!("{:?}", call.group()),
        "op": op,
        "args_hex": hex::encode(encode(args)),
        "call_hex": hex::encode(call_bytes),
    })
}

pub(super) fn host_calls() -> Value {
    let kv_set = KvSet {
        backend: KvBackend::User,
        key: "k".into(),
        value: Bytes(vec![5]),
    };
    let kv_get = KvGet {
        backend: KvBackend::Node {
            node_id: "n1".into(),
        },
        key: "k".into(),
    };
    let kv_list = KvList {
        backend: KvBackend::Scope,
        prefix: "p/".into(),
        cursor: None,
    };
    let blob_put = BlobPut {
        bytes: Bytes(vec![1, 2, 3]),
    };
    let fetch = ServerFetch {
        request: HttpRequest {
            method: HttpMethod::Post,
            url: "https://api.acme.com/v1".into(),
            headers: vec![("accept".into(), "*/*".into())],
            body: Bytes(b"hi".to_vec()),
        },
    };
    json!([
        call_case(
            "kv set, user",
            "KvSet",
            &kv_set,
            HostCall::Storage(StorageOps::KvSet(kv_set.clone()))
        ),
        call_case(
            "kv get, node",
            "KvGet",
            &kv_get,
            HostCall::Storage(StorageOps::KvGet(kv_get.clone()))
        ),
        call_case(
            "kv list, scope, no cursor",
            "KvList",
            &kv_list,
            HostCall::Storage(StorageOps::KvList(kv_list.clone()))
        ),
        call_case(
            "blob put",
            "BlobPut",
            &blob_put,
            HostCall::Storage(StorageOps::BlobPut(blob_put.clone()))
        ),
        call_case(
            "server fetch",
            "ServerFetch",
            &fetch,
            HostCall::Net(NetOps::ServerFetch(fetch.clone()))
        ),
    ])
}

fn reply_case<T: Serialize>(name: &str, reply: &HostReply<T>) -> Value {
    json!({ "name": name, "reply_hex": hex::encode(encode(reply)) })
}

pub(super) fn host_replies() -> Value {
    let response = HttpResponse {
        status: 200,
        headers: vec![("content-type".into(), "text/plain".into())],
        body: Bytes(b"ok".to_vec()),
    };
    json!([
        reply_case("ungranted", &HostReply::<()>::Refused(Refused::Ungranted)),
        reply_case("ok, unit", &HostReply::Ok(())),
        reply_case(
            "ok, a value",
            &HostReply::Ok(KvValue {
                value: Some(Bytes(vec![7, 8]))
            })
        ),
        reply_case("ok, no value", &HostReply::Ok(KvValue { value: None })),
        reply_case(
            "bad arguments",
            &HostReply::<()>::Refused(Refused::Policy("bad_arguments".into()))
        ),
        reply_case(
            "not the server's",
            &HostReply::<()>::Refused(Refused::Unavailable("workspace_server".into()))
        ),
        reply_case(
            "a limit",
            &HostReply::<()>::Refused(Refused::Limit("storage_user".into()))
        ),
        reply_case("an http response", &HostReply::Ok(response)),
    ])
}

/// What an app is answered when the page's request itself was refused (no reply bytes at all).
pub(super) fn request_refusals() -> Value {
    let unavailable = || Refused::Unavailable("server".into());
    let cases: Vec<(&str, AppsRefusal, Refused)> = vec![
        (
            "ungranted",
            AppsRefusal::Ungranted(Capability::IhttpCall),
            Refused::Ungranted,
        ),
        (
            "a limit",
            AppsRefusal::Limit("until_ms".into()),
            Refused::Limit("until_ms".into()),
        ),
        (
            "policy",
            AppsRefusal::Policy,
            Refused::Policy("server".into()),
        ),
        (
            "nobody serves it",
            AppsRefusal::NoHost,
            Refused::Unavailable("no_host".into()),
        ),
        (
            "not this server",
            AppsRefusal::ServerFeatureUnavailable,
            unavailable(),
        ),
        ("not active", AppsRefusal::NotActive, unavailable()),
        ("not there", AppsRefusal::Unavailable, unavailable()),
    ];
    Value::Array(
        cases
            .into_iter()
            .map(|(name, refusal, refused)| {
                json!({
                    "name": name,
                    "refusal": serde_json::to_value(&refusal).expect("json"),
                    "answer_hex": hex::encode(encode(&HostReply::<()>::Refused(refused))),
                })
            })
            .collect(),
    )
}

pub(super) fn routes() -> Value {
    let route = |method: HttpMethod, path: &str| Route {
        method,
        path: path.into(),
    };
    let tables: Vec<(Vec<&str>, Vec<Route>)> = vec![
        (vec!["GET /cards"], vec![route(HttpMethod::Get, "/cards")]),
        (
            vec!["POST /b/:id", "GET /a/*"],
            vec![
                route(HttpMethod::Post, "/b/:id"),
                route(HttpMethod::Get, "/a/*"),
            ],
        ),
    ];
    Value::Array(
        tables
            .into_iter()
            .map(|(lines, routes)| {
                json!({
                    "routes": lines.clone(),
                    "serve_args_hex": hex::encode(encode(&IhttpServe { routes, on: ServeOn { relay: true, p2p: false } })),
                    "digest": routes_digest(lines),
                })
            })
            .collect(),
    )
}
