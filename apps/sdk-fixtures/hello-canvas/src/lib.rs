//! The control: a well-behaved app. It subscribes to pointer events, asks for frames and paints
//! a card filling its canvas with a greeting. Every hostile fixture is judged against this one.

use citadel_app_sdk::types::calls::{DrawCommand, EventKind};
use citadel_app_sdk::{canvas, events, export_app, log, App, AppContext, AppEvent, InitFailure};

struct Hello {
    width: f32,
    height: f32,
    clicks: u32,
}

impl App for Hello {
    fn init(ctx: AppContext) -> Result<Self, InitFailure> {
        // Fire and forget: a dropped Pending is read and discarded when its reply arrives.
        let _ = events::subscribe(vec![EventKind::Pointer]);
        let _ = events::request_frames(true);
        let _ = log::info("hello-canvas started");
        Ok(Hello {
            width: ctx.size.width as f32,
            height: ctx.size.height as f32,
            clicks: 0,
        })
    }

    fn event(&mut self, event: AppEvent) {
        match event {
            AppEvent::Resize { width, height, .. } => {
                (self.width, self.height) = (width as f32, height as f32)
            }
            AppEvent::Pointer(_) => self.clicks += 1,
            _ => {}
        }
    }

    fn frame(&mut self, _dt_ms: u32) {
        let _ = canvas::draw(vec![
            DrawCommand::Clear { color: 0xffffffff },
            DrawCommand::FillRect {
                x: 10.0,
                y: 10.0,
                w: self.width - 20.0,
                h: self.height - 20.0,
                color: 0x2563ebff,
            },
            DrawCommand::FillText {
                x: 24.0,
                y: 40.0,
                text: format!("Hello, Citadel ({})", self.clicks),
                px: 16.0,
                color: 0xffffffff,
            },
        ]);
    }
}

export_app!(Hello);
