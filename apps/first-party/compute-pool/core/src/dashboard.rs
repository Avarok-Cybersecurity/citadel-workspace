//! The dashboard as canvas draw commands, pure: a header with the transport mode, the job bar,
//! one card per peer (username, transport badge, round trip, last result) and a latency
//! sparkline. Colours are `0xRRGGBBAA`.

use crate::pool::{Mode, Pool};
use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use citadel_app_sdk_types::calls::{DrawCommand, Via};

const BG: u32 = 0xf8fafcff;
const INK: u32 = 0x0f172aff;
const MUTED: u32 = 0x64748bff;
const CARD: u32 = 0xffffffff;
const EDGE: u32 = 0xcbd5e1ff;
const P2P: u32 = 0x16a34aff;
const RELAY: u32 = 0x2563ebff;
const BAR: u32 = 0x7c3aedff;

const PAD: f32 = 12.0;
const CARD_H: f32 = 56.0;

fn text(x: f32, y: f32, text: String, px: f32, color: u32) -> DrawCommand {
    DrawCommand::FillText {
        x,
        y,
        text,
        px,
        color,
    }
}

fn rect(x: f32, y: f32, w: f32, h: f32, color: u32) -> DrawCommand {
    DrawCommand::FillRect { x, y, w, h, color }
}

pub fn mode_label(mode: Mode) -> &'static str {
    match mode {
        Mode::Prefer => "P2P, then relay",
        Mode::P2p => "P2P only",
        Mode::Relay => "Relay only",
    }
}

fn badge(via: Option<Via>) -> (&'static str, u32) {
    match via {
        Some(Via::P2p) => ("P2P", P2P),
        Some(Via::Relay) => ("Relay", RELAY),
        Some(Via::Group) | None => ("—", MUTED),
    }
}

pub fn draw(pool: &Pool, width: f32, height: f32) -> Vec<DrawCommand> {
    let mut out = alloc::vec![DrawCommand::Clear { color: BG }];
    let inner = (width - 2.0 * PAD).max(0.0);
    out.push(text(
        PAD,
        24.0,
        format!("Compute Pool · {}", mode_label(pool.mode)),
        16.0,
        INK,
    ));
    let status = match pool.progress() {
        Some((done, all)) => format!("job: {done}/{all} chunks"),
        None => match pool.history.back() {
            Some(r) if r.verified => format!("last job: {} ms, verified", r.ms),
            Some(r) => format!("last job: {} ms, a wrong answer was caught", r.ms),
            None => String::from("no job yet: press Run"),
        },
    };
    out.push(text(PAD, 44.0, status, 12.0, MUTED));
    out.push(rect(PAD, 52.0, inner, 6.0, EDGE));
    if let Some((done, all)) = pool.progress() {
        out.push(rect(
            PAD,
            52.0,
            inner * done as f32 / all.max(1) as f32,
            6.0,
            BAR,
        ));
    }
    let mut y = 70.0;
    for (name, peer) in &pool.peers {
        if y + CARD_H > height - 40.0 {
            break;
        }
        out.push(rect(PAD, y, inner, CARD_H, CARD));
        out.push(DrawCommand::StrokeRect {
            x: PAD,
            y,
            w: inner,
            h: CARD_H,
            line_width: 1.0,
            color: EDGE,
        });
        out.push(text(PAD + 10.0, y + 20.0, name.clone(), 14.0, INK));
        let (label, color) = badge(peer.via);
        out.push(rect(width - PAD - 64.0, y + 8.0, 54.0, 18.0, color));
        out.push(text(width - PAD - 58.0, y + 21.0, label.into(), 11.0, CARD));
        let rtt = peer
            .rtt_ms
            .map_or(String::from("—"), |ms| format!("{ms} ms"));
        let last = peer.last.clone().unwrap_or_default();
        let line = format!("{} cores · rtt {rtt} · {last}", peer.cores);
        out.push(text(PAD + 10.0, y + 42.0, line, 11.0, MUTED));
        y += CARD_H + 8.0;
    }
    out.extend(sparkline(pool, PAD, height - 32.0, inner, 24.0));
    out
}

/// The recent latencies as a line, scaled to the largest.
fn sparkline(pool: &Pool, x: f32, y: f32, w: f32, h: f32) -> Vec<DrawCommand> {
    let points: Vec<u32> = pool.latencies.iter().copied().collect();
    let Some(&max) = points.iter().max() else {
        return Vec::new();
    };
    let step = w / (points.len().max(2) - 1) as f32;
    let at = |i: usize, v: u32| {
        (
            x + step * i as f32,
            y + h - h * v as f32 / max.max(1) as f32,
        )
    };
    points
        .windows(2)
        .enumerate()
        .map(|(i, pair)| {
            let ((x1, y1), (x2, y2)) = (at(i, pair[0]), at(i + 1, pair[1]));
            DrawCommand::Line {
                x1,
                y1,
                x2,
                y2,
                line_width: 1.5,
                color: BAR,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::PoolMsg;

    fn texts(cmds: &[DrawCommand]) -> Vec<String> {
        cmds.iter()
            .filter_map(|c| match c {
                DrawCommand::FillText { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn each_peer_has_a_card_with_its_transport_and_round_trip() {
        let mut pool = Pool::new("alice", 4);
        pool.on_msg("bob", PoolMsg::Heartbeat { cores: 8, load: 0 });
        pool.run(crate::jobs::Job::Primes { lo: 0, hi: 10 })
            .unwrap();
        pool.on_msg("bob", PoolMsg::Claim { job_id: 0 });
        pool.answered("bob", Ok(alloc::vec![]), Via::P2p);
        let all = texts(&draw(&pool, 400.0, 300.0));
        assert!(all.contains(&"bob".into()), "{all:?}");
        assert!(all.contains(&"P2P".into()));
        assert!(all.iter().any(|t| t.starts_with("8 cores · rtt 0 ms")));
        assert!(all.iter().any(|t| t.contains("P2P, then relay")));
        pool.mode = Mode::Relay;
        assert!(texts(&draw(&pool, 400.0, 300.0))
            .iter()
            .any(|t| t.contains("Relay only")));
    }

    #[test]
    fn cards_stop_at_the_canvas_edge_and_a_sparkline_needs_two_points() {
        let mut pool = Pool::new("alice", 4);
        for i in 0..20 {
            pool.on_msg(
                &format!("p{i:02}"),
                PoolMsg::Heartbeat { cores: 1, load: 0 },
            );
        }
        let cards = |h: f32| {
            texts(&draw(&pool, 300.0, h))
                .iter()
                .filter(|t| t.starts_with('p'))
                .count()
        };
        assert_eq!(cards(200.0), 1);
        assert!(cards(2000.0) == 20);
        let lines = |p: &Pool| {
            draw(p, 300.0, 300.0)
                .iter()
                .filter(|c| matches!(c, DrawCommand::Line { .. }))
                .count()
        };
        pool.latencies.push_back(5);
        assert_eq!(lines(&pool), 0);
        pool.latencies.push_back(9);
        assert_eq!(lines(&pool), 1);
    }
}
