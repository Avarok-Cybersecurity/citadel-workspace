//! The well-behaved close: in `close` the app writes what it holds to `storage.user` and reports
//! the write when its reply arrives, which the host delivers before it ends the instance. The read
//! it starts at init reports whether its reply came while running or after close began (a host
//! that closes with that read still pending must deliver it then). A second `app_close` must not
//! run `close` again: `close` reports how many times it ran.

use citadel_app_sdk::{
    export_app, storage, App, AppContext, AppEvent, CloseContext, CloseReason, InitFailure,
    SuspendReason,
};
use fixture_report::{answer, report};

struct Flush {
    edits: u32,
    closes: u32,
}

impl App for Flush {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        storage::user().get("state").then(|app: &mut Flush, r| {
            let when = if app.closes == 0 {
                "running"
            } else {
                "closing"
            };
            report("restored", &format!("{}:{when}", answer(&r)));
        });
        Ok(Flush {
            edits: 0,
            closes: 0,
        })
    }

    fn event(&mut self, event: AppEvent) {
        if let AppEvent::UiAction { .. } = event {
            self.edits += 1;
        }
    }

    fn suspend(&mut self, reason: SuspendReason) {
        report("suspended", &format!("{reason:?}"));
    }

    fn resume(&mut self) {
        report("resumed", "ok");
    }

    fn close(&mut self, ctx: &CloseContext, reason: CloseReason) {
        self.closes += 1;
        report(
            "close",
            &format!("{reason:?}:{}:{}", ctx.grace_ms, self.closes),
        );
        let state = format!("edits={}", self.edits);
        storage::user()
            .set("state", state.as_bytes())
            .then(|_: &mut Flush, r| report("flush", &answer(&r)));
    }
}

export_app!(Flush);
