//! Panics in `app_event` on the `panic` action. The SDK logs the panic through `log` and traps;
//! nothing unwinds into the host. Every other event is handled normally (the control).

use citadel_app_sdk::{export_app, log, App, AppContext, AppEvent, InitFailure};

struct Panics;

impl App for Panics {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        Ok(Panics)
    }

    fn event(&mut self, event: AppEvent) {
        match event {
            AppEvent::UiAction { id } if id == "panic" => panic!("boom from app_event"),
            other => {
                let _ = log::info(&format!("handled {other:?}"));
            }
        }
    }
}

export_app!(Panics);
