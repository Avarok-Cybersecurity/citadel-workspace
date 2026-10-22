//! Tries to grow its memory past the host's ceiling: one 2 GiB grow, then one page at a time
//! until refused, then an allocation larger than what is left. Reports what each step saw, then
//! dies on the last one (the host must survive it).

use citadel_app_sdk::{export_app, App, AppContext, AppEvent, InitFailure};
use core::arch::wasm32::{memory_grow, memory_size};
use fixture_report::{code, report};

struct OverMemory;

impl App for OverMemory {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        report("grow_2gib", &code(memory_grow(0, 32_768) as i32));
        let mut grown = 0;
        while memory_grow(0, 1) != usize::MAX {
            grown += 1;
        }
        report("pages_grown", &grown.to_string());
        report("pages_at_ceiling", &memory_size(0).to_string());
        report("one_more_page", &code(memory_grow(0, 1) as i32));
        let mut fallible: Vec<u8> = Vec::new();
        let refused = fallible.try_reserve_exact(64 << 20).is_err();
        report(
            "try_reserve_64mib",
            if refused { "refused" } else { "granted" },
        );
        let doomed = vec![1u8; 64 << 20];
        report("infallible_64mib", &doomed.len().to_string());
        Ok(OverMemory)
    }

    fn event(&mut self, _event: AppEvent) {}

    // The ABI's lifecycle: nothing to pause, nothing to persist.
    fn suspend(&mut self, _reason: citadel_app_sdk::SuspendReason) {}

    fn resume(&mut self) {}

    fn close(
        &mut self,
        _ctx: &citadel_app_sdk::CloseContext,
        _reason: citadel_app_sdk::CloseReason,
    ) {
    }
}

export_app!(OverMemory);
