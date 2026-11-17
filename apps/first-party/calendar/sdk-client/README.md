# citadel-calendar-sdk

Add, change, remove and read events in the member's Calendar from another Citadel app
(Calendar design §3.8). The Calendar stays the only writer of its own keys: every call is an
internal-HTTP request to the Calendar's instance in the member's own session, and the Calendar
decides it.

## What an app needs

1. **Its manifest** lists the call:
   ```json
   {"cap": "ihttp.call", "targets": ["net.avarok.calendar"], "why": "Puts your due dates on your calendar"}
   ```
2. **Its installer** holds `AppInstallAllowInternalCall`.
3. **The member's consent.** The first call that changes their calendar opens the Calendar's
   prompt, "<app> wants to add events to your calendar", with Allow, Allow once and Refuse.
   Allow and Refuse are remembered; the member can change either in the Calendar's settings.
   Reads need no prompt.

## The rules the Calendar holds an app to

- **Same member only.** The Calendar answers with its own member's authority, so a request from
  an app running in another member's session is refused with `CrossUser` on every route except
  `/health`. Booking another member goes through their booking page (`/book`), which runs the
  booking rules.
- **Own events only.** An app changes or removes only the events it added, and only at the
  revision it last saw. A stale revision is refused with the current one.
- **The member's own events.** What an app adds is posted on the node under the member's name,
  or kept private. It may be pulled up to an ancestor, but it is never pushed down: only a page's
  official events are shown on the pages below it.
- **Limits.** 60 changes a minute and 500 kept events, per app, per member.

## Routes

Bodies are CBOR, in calendar-core's versioned codec (`v: 1`). Every type below is defined once,
in `calendar-core/src/sdk.rs`; this crate, the Calendar and the page's TypeScript mirror all use
that definition.

| Route | Body | Success | Refusals |
|---|---|---|---|
| `GET /events?node=&from=&to=&include=own\|inherited\|up` | | 200 `Events` | 400, 403 |
| `POST /events` | `NewEvent` | 201 `EventRef` | 403, 422, 429 |
| `PATCH /events/:id` | `EventPatch` | 200 `Rev` | 403, 404, 409, 422, 429 |
| `DELETE /events/:id` | `Rev` | 204 | 403, 404, 409, 429 |
| `GET /free-busy?node=&users=a,b&from=&to=` | | 200 `FreeBusy` | 400, 403 |
| `GET /health` | | 200 `Health` | |

An error answer's body is an `SdkRefusal { code, current_rev, detail }`; the status is the
code's. Query values are percent-encoded, usernames one at a time.

## Rust

```rust
use citadel_calendar_sdk::{Calendar, CalendarRefusal, NewEvent};

let calendar = Calendar::new(&ctx);
let _call = calendar.add_event(&event, |app: &mut MyApp, added| match added {
    Ok(r) => app.remember(r.id, r.rev),
    Err(CalendarRefusal::NotConsented) => app.say("The member did not allow this."),
    Err(CalendarRefusal::Stale { current_rev }) => app.refresh(current_rev),
    Err(other) => app.say(&format!("{other:?}")),
});
```

`update_event`, `remove_event`, `list`, `free_busy` and `health` follow the same shape. The calls
exist in the `wasm32-unknown-unknown` build; natively the crate is its wire (`wire`), which is
what its tests exercise against calendar-core's side of every route.

## TypeScript (glue apps in the page)

`citadel-workspaces/src/lib/calendar/sdk-client.ts` makes the same calls over the page's
`IhttpClient`, encoding and decoding through the Calendar's engine, so it uses the same codec.
