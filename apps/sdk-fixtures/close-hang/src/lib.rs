//! `close` never returns. The host must end the instance once the install's grace has passed,
//! and must not wait on it: nothing about closing may hang the page.

use citadel_app_sdk::{
    export_app, log, App, AppContext, AppEvent, CloseContext, CloseReason, InitFailure,
    SuspendReason,
};

struct Hang;

impl App for Hang {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        Ok(Hang)
    }

    fn event(&mut self, _event: AppEvent) {}

    fn suspend(&mut self, _reason: SuspendReason) {}

    fn resume(&mut self) {}

    fn close(&mut self, _ctx: &CloseContext, _reason: CloseReason) {
        let _ = log::info("close-hang closing forever");
        let mut spins: u64 = 0;
        loop {
            spins = core::hint::black_box(spins.wrapping_add(1));
        }
    }
}

export_app!(Hang);
