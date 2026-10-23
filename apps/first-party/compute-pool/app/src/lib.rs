//! Compute Pool (`net.avarok.compute-pool`): members who installed and allowed it share
//! deterministic jobs. The `pool` topic carries heartbeats, announcements, claims and results;
//! the chunks travel over internal HTTP, peer to peer when they can (`PreferP2pThenRelay`), and
//! the toolbar forces P2P or the relay to show each one, and its refusal. Everything the app
//! decides is in `compute-pool-core`; this crate performs its actions.

use citadel_app_sdk::ihttp::{self, Address, FanoutLimits, Outbound, Outcome, ServeOn, Via};
use citadel_app_sdk::topic::{self, Topic, TopicEvent};
use citadel_app_sdk::types::calls::{EventKind, HttpMethod, Route, ToolbarItem};
use citadel_app_sdk::types::{decode, encode};
use citadel_app_sdk::SuspendReason;
use citadel_app_sdk::{canvas, events, export_app, log, storage, ui};
use citadel_app_sdk::{App, AppContext, AppEvent, CloseContext, CloseReason, InitFailure};
use compute_pool_core::dashboard;
use compute_pool_core::jobs::Job;
use compute_pool_core::limits::*;
use compute_pool_core::pool::{Action, Mode, Pool, Record};
use compute_pool_core::wire::{self, ChunkResults, PoolMsg, ROUTES, TOPIC};

const HISTORY_KEY: &str = "history";

struct ComputePool {
    app_id: String,
    pool: Pool,
    topic: Option<Topic>,
    size: (f32, f32),
}

fn toolbar() -> Vec<ToolbarItem> {
    let item = |id: &str, label: &str| ToolbarItem {
        id: id.into(),
        label: label.into(),
        icon_name: None,
    };
    vec![
        item("run-primes", "Run: count primes"),
        item("run-sha", "Run: SHA-256 chains"),
        item("mode-prefer", "P2P, then relay"),
        item("mode-p2p", "P2P only"),
        item("mode-relay", "Relay only"),
    ]
}

fn on_topic(app: &mut ComputePool, event: TopicEvent) {
    let TopicEvent::Message { from, body } = event else {
        return;
    };
    if body.0.len() > TOPIC_MAX_MSG_BYTES as usize {
        return;
    }
    if let Ok(msg) = decode::<PoolMsg>(&body.0) {
        let actions = app.pool.on_msg(&from.username, msg);
        app.perform(actions);
    }
}

fn serve_job(app: &mut ComputePool, request: ihttp::Request, writer: ihttp::ResponseWriter) {
    let answer = wire::serve(&app.pool.me, request.method, &request.path, &request.body);
    let (status, body) = if answer.body.len() > MAX_RESPONSE_BYTES as usize {
        (413, Vec::new())
    } else {
        (answer.status, answer.body)
    };
    let headers = vec![("content-type".into(), "application/cbor".into())];
    if let Err(e) = writer.respond(status, headers, &body) {
        let _ = log::warn(&format!("respond: {e:?}"));
    }
}

/// What one worker's outcome tells the pool.
fn answer_of(outcome: &Outcome, planned: Via) -> (Result<ChunkResults, String>, Via) {
    match outcome {
        Outcome::Ok(r) if r.head.status == 200 => (
            decode::<ChunkResults>(&r.body).map_err(|_| "unreadable answer".into()),
            r.via,
        ),
        Outcome::Ok(r) => (Err(format!("status {}", r.head.status)), r.via),
        Outcome::Failed(refused) => (Err(format!("{refused:?}")), planned),
        Outcome::Skipped => (Err("skipped".into()), planned),
    }
}

impl ComputePool {
    fn perform(&mut self, actions: Vec<Action>) {
        for action in actions {
            match action {
                Action::Publish(msg) => self.publish(&msg),
                Action::Fanout {
                    targets,
                    assignment,
                } => self.fan_out(targets, &assignment),
                Action::Save(record) => self.save(&record),
                Action::Log(line) => drop(log::info(&line)),
            }
        }
    }

    fn publish(&self, msg: &PoolMsg) {
        if let Some(topic) = &self.topic {
            if let Err(e) = topic.publish(&encode(msg)) {
                let _ = log::warn(&format!("publish: {e:?}"));
            }
        }
    }

    fn fan_out(&mut self, workers: Vec<String>, assignment: &wire::Assignment) {
        let to = |username: &String| Address::User {
            app_id: self.app_id.clone(),
            username: username.clone(),
        };
        let targets: Vec<Address> = workers.iter().map(to).collect();
        let request = Outbound {
            method: HttpMethod::Post,
            path: "/job/chunks".into(),
            query: String::new(),
            headers: vec![("content-type".into(), "application/cbor".into())],
            body: encode(assignment),
        };
        let limits = FanoutLimits {
            max_concurrency: MAX_FANOUT_CONCURRENCY,
            per_call_ms: PER_CALL_MS,
            budget_ms: MAX_FANOUT_MS,
            max_total_bytes: u64::from(MAX_FANOUT_BYTES),
        };
        let transport = self.pool.mode.transport();
        let planned = if self.pool.mode == Mode::Relay {
            Via::Relay
        } else {
            Via::P2p
        };
        let each = move |app: &mut ComputePool, i: usize, outcome: &Outcome| {
            let (answer, via) = answer_of(outcome, planned);
            let actions = app.pool.answered(&workers[i], answer, via);
            app.perform(actions);
        };
        let done = |app: &mut ComputePool, _all| {
            let actions = app.pool.finish();
            app.perform(actions);
        };
        let _running = ihttp::fanout(targets, request, transport, limits, each, done);
    }

    fn save(&self, record: &Record) {
        let history: Vec<&Record> = self.pool.history.iter().collect();
        let _ = storage::user().set(HISTORY_KEY, &encode(&history));
        // One key per member, so two members finishing at once never overwrite each other.
        let key = format!("jobs/{}", self.pool.me);
        let _ = storage::scope().set(&key, &encode(&record.job_id));
    }
}

impl App for ComputePool {
    fn init(ctx: AppContext) -> Result<Self, InitFailure> {
        let routes = ROUTES
            .iter()
            .map(|(method, path)| Route {
                method: method.clone(),
                path: (*path).into(),
            })
            .collect();
        ihttp::serve(
            routes,
            ServeOn {
                relay: true,
                p2p: true,
            },
            serve_job,
        )
        .then(|_: &mut ComputePool, r| {
            if let Err(e) = r {
                let _ = log::warn(&format!("serve: {e:?}"));
            }
        });
        topic::open(TOPIC, on_topic).then(|app: &mut ComputePool, r| match r {
            Ok(t) => app.topic = Some(t),
            Err(e) => {
                let _ = log::warn(&format!("topic: {e:?}"));
            }
        });
        storage::user()
            .get(HISTORY_KEY)
            .then(|app: &mut ComputePool, r| {
                if let Ok(Some(bytes)) = r {
                    if let Ok(history) = decode::<Vec<Record>>(&bytes) {
                        app.pool.history = history.into();
                    }
                }
            });
        let _ = ui::set_toolbar(toolbar());
        let _ = events::subscribe(vec![EventKind::Pointer]);
        let _ = events::request_frames(true);
        Ok(ComputePool {
            app_id: ctx.app_id,
            pool: Pool::new(&ctx.acting_username, 1),
            topic: None,
            size: (ctx.size.width as f32, ctx.size.height as f32),
        })
    }

    fn event(&mut self, event: AppEvent) {
        match event {
            AppEvent::Resize { width, height, .. } => self.size = (width as f32, height as f32),
            AppEvent::UiAction { id } => {
                let job = match id.as_str() {
                    "run-primes" => Some(Job::Primes {
                        lo: 0,
                        hi: 2_000_000,
                    }),
                    "run-sha" => Some(Job::ShaChain {
                        seed: self.pool.now_ms,
                        n: 20_000,
                    }),
                    "mode-prefer" | "mode-p2p" | "mode-relay" => {
                        self.pool.mode = match id.as_str() {
                            "mode-p2p" => Mode::P2p,
                            "mode-relay" => Mode::Relay,
                            _ => Mode::Prefer,
                        };
                        None
                    }
                    _ => None,
                };
                if let Some(job) = job {
                    match self.pool.run(job) {
                        Some(actions) => self.perform(actions),
                        None => drop(ui::toast("A job is already running")),
                    }
                }
            }
            _ => {}
        }
    }

    fn frame(&mut self, dt_ms: u32) {
        let actions = self.pool.tick(dt_ms);
        self.perform(actions);
        let _ = canvas::draw(dashboard::draw(&self.pool, self.size.0, self.size.1));
    }

    fn suspend(&mut self, _reason: SuspendReason) {}

    fn resume(&mut self) {}

    /// The history is saved as each job finishes; a closing app may call only storage and log,
    /// and the host ends the topic membership with the instance.
    fn close(&mut self, _ctx: &CloseContext, _reason: CloseReason) {}
}

export_app!(ComputePool);
