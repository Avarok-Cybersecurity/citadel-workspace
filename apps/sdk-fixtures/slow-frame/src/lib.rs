//! Never returns from `app_frame`. A host must stop it (watchdog, fuel) and stay responsive.

use citadel_app_sdk::{export_app, log, App, AppContext, AppEvent, InitFailure};

struct SlowFrame;

impl App for SlowFrame {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        let _ = log::info("slow-frame started");
        Ok(SlowFrame)
    }

    fn event(&mut self, _event: AppEvent) {}

    fn frame(&mut self, dt_ms: u32) {
        let mut spins = dt_ms as u64;
        loop {
            spins = core::hint::black_box(spins.wrapping_add(1));
        }
    }
}

export_app!(SlowFrame);
