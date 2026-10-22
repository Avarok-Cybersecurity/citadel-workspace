//! Asks for more than any reply may hold: a 4 GiB file read (the host must refuse it as a
//! limit), and an 8 MiB read that the host may serve but the app's memory cannot hold (the SDK
//! must answer a limit, not trap). Replies may be pending: each is reported when it arrives.

use citadel_app_sdk::{export_app, files, App, AppContext, AppEvent, InitFailure};
use fixture_report::probe;

struct HugeReply;

impl App for HugeReply {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        probe::<HugeReply, _>("read_4gib", files::read("big.bin", 0, u32::MAX));
        probe::<HugeReply, _>("read_8mib", files::read("big.bin", 0, 8 << 20));
        probe::<HugeReply, _>("read_16b", files::read("big.bin", 0, 16));
        Ok(HugeReply)
    }

    fn event(&mut self, _event: AppEvent) {}
}

export_app!(HugeReply);
