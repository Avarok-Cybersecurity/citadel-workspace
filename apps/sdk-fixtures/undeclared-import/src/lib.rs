//! Imports `net` (it calls a server fetch) while its manifest declares no `net.*` capability.
//! A host must refuse to load it; declaring `net.server` admits the same bytes.

use citadel_app_sdk::types::calls::{HttpMethod, HttpRequest};
use citadel_app_sdk::types::Bytes;
use citadel_app_sdk::{export_app, net, App, AppContext, AppEvent, InitFailure};

struct Undeclared;

impl App for Undeclared {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        let request = HttpRequest {
            method: HttpMethod::Get,
            url: "https://api.example.com/".into(),
            headers: vec![],
            body: Bytes::default(),
        };
        fixture_report::probe::<Undeclared, _>("server_fetch", net::server_fetch(request));
        Ok(Undeclared)
    }

    fn event(&mut self, _event: AppEvent) {}
}

export_app!(Undeclared);
