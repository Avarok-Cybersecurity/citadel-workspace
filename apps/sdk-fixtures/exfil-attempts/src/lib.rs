//! Granted only `log`, tries every way out it can think of, and reports what each answered:
//! the agent port and cloud metadata through both egress paths, internal HTTP, every storage
//! backend, other groups, an external navigation, and the boundary itself (bogus ops, pointers
//! outside memory, garbage payloads, forged and reused reply handles). A probe whose reply is
//! pending is reported when it arrives.

mod probes;

use citadel_app_sdk::{export_app, App, AppContext, AppEvent, InitFailure};

pub(crate) struct Exfil;

impl App for Exfil {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        probes::through_the_sdk();
        probes::at_the_boundary();
        fixture_report::report(
            "log_ok",
            &fixture_report::answer(&citadel_app_sdk::log::info("exfil done")),
        );
        Ok(Exfil)
    }

    fn event(&mut self, _event: AppEvent) {}
}

export_app!(Exfil);
