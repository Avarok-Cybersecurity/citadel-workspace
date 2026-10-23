//! Calls the host after closing began. Granted everything it calls, so every refusal here is the
//! lifecycle's: while closing only `storage` and `log` are served, and every other group answers
//! `unavailable:closing` at once, whether it would have been granted, pending or ungranted.
//! Input after close began never reaches the app (`late` is never reported).

use citadel_app_sdk::types::calls::{HttpMethod, HttpRequest};
use citadel_app_sdk::types::Bytes;
use citadel_app_sdk::{
    export_app, log, net, nodes, notify, storage, ui, App, AppContext, AppEvent, CloseContext,
    CloseReason, InitFailure, SuspendReason,
};
use fixture_report::{answer, probe, report};

struct CloseCalls;

impl App for CloseCalls {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        Ok(CloseCalls)
    }

    fn event(&mut self, event: AppEvent) {
        if let AppEvent::UiAction { id } = event {
            report("late", &id);
        }
    }

    fn suspend(&mut self, _reason: SuspendReason) {}

    fn resume(&mut self) {}

    fn close(&mut self, _ctx: &CloseContext, _reason: CloseReason) {
        probe::<CloseCalls, _>("closing_nodes", nodes::get("root"));
        probe::<CloseCalls, _>("closing_notify", notify::notify("bye", "closing"));
        probe::<CloseCalls, _>("closing_toast", ui::toast("closing"));
        let request = HttpRequest {
            method: HttpMethod::Get,
            url: "https://api.acme.com/".into(),
            headers: Default::default(),
            body: Bytes(vec![]),
        };
        probe::<CloseCalls, _>("closing_net", net::server_fetch(request));
        probe::<CloseCalls, _>("closing_storage", storage::user().set("k", b"v"));
        report("closing_log", &answer(&log::info("still logging")));
    }
}

export_app!(CloseCalls);
