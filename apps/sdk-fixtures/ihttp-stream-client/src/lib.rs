//! A client holding only `ihttp.call` reads a streamed response longer than the initial credit
//! (IHTTP_INITIAL_CREDIT body frames). Past that, each further chunk arrives only because the SDK
//! returned credit with `IhttpConsumed` for the ones it read; if the host refuses that op to a
//! caller, the response stalls after the initial credit and `stream` is never reported.
//!
//! Reports `head=<status>`, then `stream=complete:<chunks>:<bytes>` at End, or
//! `stream=failed:<answer>`.

use citadel_app_sdk::ihttp::{Address, Client, ClientEvent, Outbound};
use citadel_app_sdk::types::calls::HttpMethod;
use citadel_app_sdk::*;
use fixture_report::{answer, report};

#[derive(Default)]
struct StreamClient {
    chunks: u32,
    bytes: usize,
}

fn on(app: &mut StreamClient, event: ClientEvent) {
    match event {
        ClientEvent::Head(h) => report("head", &h.status.to_string()),
        ClientEvent::Body(b) => {
            app.chunks += 1;
            app.bytes += b.len();
        }
        ClientEvent::End => report(
            "stream",
            &format!("complete:{}:{}", app.chunks, app.bytes),
        ),
        ClientEvent::Failed(e) => report("stream", &format!("failed:{}", answer::<()>(&Err(e)))),
    }
}

impl App for StreamClient {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        let to = Address::User {
            app_id: "com.acme.stream".into(),
            username: "bob".into(),
        };
        let request = Outbound {
            method: HttpMethod::Get,
            path: "/stream".into(),
            query: String::new(),
            headers: vec![],
            body: vec![],
        };
        Client::new(to).call_stream(request, on);
        Ok(StreamClient::default())
    }

    fn event(&mut self, _event: AppEvent) {}
}

export_app!(StreamClient);
