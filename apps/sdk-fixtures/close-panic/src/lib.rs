//! `close` panics. The SDK logs the panic and traps; the host ends the instance as closed with
//! a trap, without waiting for the grace and without anything unwinding into it.

use citadel_app_sdk::{
    export_app, App, AppContext, AppEvent, CloseContext, CloseReason, InitFailure, SuspendReason,
};

struct PanicsInClose;

impl App for PanicsInClose {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        Ok(PanicsInClose)
    }

    fn event(&mut self, _event: AppEvent) {}

    fn suspend(&mut self, _reason: SuspendReason) {}

    fn resume(&mut self) {}

    fn close(&mut self, _ctx: &CloseContext, reason: CloseReason) {
        panic!("boom from app_close ({reason:?})");
    }
}

export_app!(PanicsInClose);
