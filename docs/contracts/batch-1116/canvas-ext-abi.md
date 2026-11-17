# Contract: CW-5 canvas extension (SW rev 3 §7.3, plan §4 H3) — FROZEN 2026-11-16

Additive to ABI-1's `calls/canvas.rs` (`Clear, FillRect, StrokeRect, Line, FillText`;
`MeasureText`). Coordinates are CSS pixels, colours `0xRRGGBBAA` as today. Parties: SDK types +
host renderer + a11y overlay (H3), `sw-graph` painters (S1), sw-app (S6).

## 1. New `DrawCommand` variants (`#[serde(rename_all = "snake_case")]`, same enum)

```rust
FillCircle   { cx: f32, cy: f32, r: f32, color: u32 }
StrokeCircle { cx: f32, cy: f32, r: f32, line_width: f32, color: u32 }
Path         { points: Vec<(f32, f32)>, closed: bool, fill: Option<u32>, stroke: Option<(f32, u32)> }   // 2..=256 points; stroke = (line_width, color)
Arc          { cx: f32, cy: f32, r: f32, start: f32, end: f32, line_width: f32, color: u32 }         // radians, clockwise from +x
Region       { id: String, x: f32, y: f32, w: f32, h: f32, label: String, role: RegionRole }
#[serde(rename_all = "snake_case")] pub enum RegionRole { Button, Link, Img, Group }
```
Wire form: the serde externally-tagged map of the ABI's codec, e.g. `{"fill_circle": {"cx": …}}`;
`Path.points` is an array of 2-arrays. Limits enforced by the host before painting: `Path` with
fewer than 2 or more than 256 points, a `Region` with `id` outside `[a-z0-9_-]{1,64}` or `label`
over 256 characters, or more than 512 `Region`s in one frame → the whole `CanvasDraw` is refused
(`Refused::Limit`), nothing of it painted. `fill: None` and `stroke: None` together → refused.

## 2. `Region` semantics (accessibility and hit-testing)

The host renders, per `Region`, one invisible focusable element positioned over the rectangle,
with `role` and an accessible name `label`, in draw order (which is DOM order and so tab order).
Keyboard activation (Enter/Space) and pointer activation inside the rectangle both deliver
`AppEvent::Activate { id: String }` (new event variant). Regions are **replaced** by each frame's
list: a frame without `Region`s clears the overlay. `Region`s paint nothing.

## 3. Host obligations

- Same canvas, same frame: the new commands interleave with ABI-1 ones in order.
- An ABI-1 host that does not know these variants fails to decode the `CanvasDraw` and refuses
  the frame; guests detect support with `ctx.sdk_abi_minor >= 1` (bump `sdk.abi` minor to `1`;
  `citadel-app-abi-1` stays the major) and use the `RectOnlyPainter` otherwise.
- Reduced motion is the guest's business (`sw-graph` `Lite` keyframes); the host changes nothing.

## 4. Tests (plan §4 H3 row)

Draw-list corpus decoded identically by the Rust types and the TS host; a frame with a `Region`
yields an element with the accessible name after animations settle (axe); control: drop the
overlay → axe red. Limits: 257-point path refused; `fill`/`stroke` both absent refused.
