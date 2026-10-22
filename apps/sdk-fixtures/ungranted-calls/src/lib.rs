//! Calls every group an install must be granted (all but the intrinsic canvas, ui, events,
//! navigate and log; one op each, every storage backend) and, raw, an ungranted group with a
//! bogus op, a garbage payload and a pointer outside memory. With nothing granted every answer
//! must be exactly `{refused: "ungranted"}`, at once (a refusal is never pending). `app_init`
//! answers 0 when all were; 100 + the group index of the first that was not; 200/201 for the raw
//! probes.

use citadel_app_sdk::ihttp::{Address, Outbound};
use citadel_app_sdk::types::calls::{HttpMethod, HttpRequest};
use citadel_app_sdk::types::{encode, Bytes, Group, HostReply};
use citadel_app_sdk::*;
use fixture_report::raw;

struct UngrantedCalls;

fn request() -> HttpRequest {
    HttpRequest {
        method: HttpMethod::Get,
        url: "https://api.example.com/".into(),
        headers: vec![],
        body: Bytes::default(),
    }
}

fn now<T: 'static>(mut p: Pending<T>) -> Option<Result<(), Refused>> {
    p.take_ready().map(|r| r.map(drop))
}

fn every_group() -> Vec<(Group, Option<Result<(), Refused>>)> {
    vec![
        (Group::Nodes, now(nodes::get("root"))),
        (Group::Md, now(md::read_zone())),
        (Group::Files, now(files::list("/"))),
        (Group::Chat, now(chat::recent(1))),
        (Group::Members, now(members::list())),
        (Group::Storage, now(storage::user().get("k"))),
        (Group::Storage, now(storage::scope().get("k"))),
        (Group::Storage, now(storage::node("n").get("k"))),
        (Group::Storage, now(storage::local().get("k"))),
        (Group::Storage, now(storage::blob::get("00"))),
        (Group::Storage, now(storage::files::list("/"))),
        (Group::Net, now(net::host_fetch(request()))),
        (Group::Net, now(net::server_fetch(request()))),
        (
            Group::Ihttp,
            now(ihttp::serve(vec![], |_: &mut UngrantedCalls, _, _| {})),
        ),
        (Group::Clipboard, now(clipboard::read_text())),
        (Group::Notify, now(notify::notify("t", "b"))),
        (Group::Documents, now(documents::open("n"))),
    ]
}

impl App for UngrantedCalls {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        for (group, result) in every_group() {
            if result != Some(Err(Refused::Ungranted)) {
                return Err(InitFailure(100 + group.index()));
            }
        }
        // A client call to an ungranted group fails, and only through its callback (checked by
        // the host's log staying empty: nothing here may succeed).
        let to = Address::User {
            app_id: "com.acme.other".into(),
            username: "bob".into(),
        };
        let out = Outbound {
            method: HttpMethod::Get,
            path: "/".into(),
            query: String::new(),
            headers: vec![],
            body: vec![],
        };
        ihttp::Client::new(to).call(out, |_: &mut UngrantedCalls, r| {
            assert_eq!(r.err(), Some(Refused::Ungranted))
        });
        let stub = encode(&HostReply::<()>::Refused(Refused::Ungranted));
        let garbage = [0xffu8; 7];
        // SAFETY: the host reads 7 bytes of `garbage`, or none.
        let bogus =
            unsafe { raw::nodes(999, garbage.as_ptr() as usize as i32, garbage.len() as i32) };
        if raw::read(bogus).as_deref() != Ok(&stub[..]) {
            return Err(InitFailure(200));
        }
        // SAFETY: an out-of-bounds pointer; an ungranted group must not even look at it.
        let outside = unsafe { raw::nodes(1, 0xffff_fff0_u32 as i32, 64) };
        if raw::read(outside).as_deref() != Ok(&stub[..]) {
            return Err(InitFailure(201));
        }
        Ok(UngrantedCalls)
    }

    fn event(&mut self, _event: AppEvent) {}
}

export_app!(UngrantedCalls);
