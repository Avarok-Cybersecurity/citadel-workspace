# The Citadel app lifecycle

How an app instance starts, pauses, and ends. This covers the guest SDK, the ABI, the browser host,
and the workspace server. It adds to the build plan's R4.6, the SDK surface
(`docs/plans/citadel-apps-and-coupons-design-r2.md`). Where this page and the code disagree, the
code is right, and the tests named below say which code that is.

## One state machine

There is one state machine, written once. `LifecycleState::after` in
`citadel-internal-service/citadel-app-sdk-types/src/lifecycle.rs` is the transition table. The
guest SDK steps it (`citadel-app-sdk/src/life.rs`), and so does the reference host
(`apps/sdk-fixtures/harness/src/host.rs`). The browser host reads the same table as
`LIFECYCLE_TRANSITIONS`, which is generated into `bindings/AbiConstants.ts` and copied to
`citadel-workspaces/src/lib/citadel-apps/sdk/generated/`. The bindings drift test fails if the
copy is stale. `citadel-workspaces/src/lib/citadel-apps/host/lifecycle.ts` only looks the table up.

```text
Created --initialised--> Initialised --start--> Running <--suspend/resume--> Suspended
                              |                    |                            |
                              +-------close--------+------------close-----------+
                                                   v
                                                Closing --settled--> Closed
any state but Closed --abort--> Closed   (init failed, a trap, the watchdog, the grace expired)
```

The machine refuses any step it does not list: a second close, a resume of a running app, or
anything after `Closed`. The guest reports a refused step as `Delivery::Illegal`. In the host,
`start()`, `suspend()` and `resume()` return false and send nothing.
`citadel-app-sdk-types/tests/lifecycle.rs` pins the whole table, cell by cell.

What each state lets through to the app (`admit`, `citadel-app-sdk/src/life.rs`):

| state | frames, pointer, key, wheel, focus | other events | `ReplyReady` | host calls |
|---|---|---|---|---|
| Initialised | dropped | delivered | delivered | all |
| Running | delivered | delivered | delivered | all |
| Suspended | dropped (the host sends none) | delivered | delivered | all |
| Closing | dropped | dropped | delivered | `storage` and `log` only; any other call is refused with `{unavailable: "closing"}` |
| Closed | dropped | dropped | dropped | none; every call is refused with `{unavailable: "closed"}` |

The calls a closing app may still make are `CLOSING_GROUPS`. Both hosts check that list before
anything else, including the grant. In the browser this check is the imports' `gate`
(`host/imports.ts`). In the reference host it is `group_call`
(`apps/sdk-fixtures/harness/src/state.rs`).

## The trait

`citadel_app_sdk::App` requires five functions: `init`, `event`, `suspend(reason)`, `resume()`
and `close(&CloseContext, reason)`. `frame` keeps its default. `CloseContext::grace_ms` tells the
app how long it has to close.

| CloseReason | code | when |
|---|---|---|
| `unmount` | 0 | the zone or pane went away, or the person left the page |
| `uninstall` | 1 | the install was removed |
| `access_revoked` | 2 | the install no longer reaches this person here: it was disabled for them, suspended, or they left its scope |
| `host_shutdown` | 3 | the page itself is closing or reloading |
| `version_update` | 4 | another release replaces this one, or one is waiting on consent |
| `host_error` | 5 | the host must stop the app for a fault of its own |

The size of the surface is in `AppContext.size` at `app_init`. Changes arrive as
`AppEvent::Resize`.

## The ABI: `app_close` is required

`app_close(reason: i32) -> i32` is the sixth export, and it is required in ABI 1
(`REQUIRED_EXPORTS`). It answers `CLOSE_RESULT`: `ok` (0), `unknown_reason` (1), or
`not_running` (2). `not_running` covers a second close and a close before init.

The export is required, not optional, because an optional close is one the host can never
count on. Every host would need a second unmount path for modules without it, and that path
would be the one actually taken. Making it required costs nothing today:

- the catalogue (`apps/catalogue/catalogue.json`) lists no app;
- Citadel Docs runs on the glue ABI, not this one;
- no ABI 1 module has been published.

`export_app!` emits `app_close` for every app. Both inspectors refuse a module without it, with
`missing_export:app_close`: the Rust one (`citadel-app-abi-inspect/src/rules.rs`) and the
browser's (`host/inspect.ts`). The SDK fixtures and the inspector tests pin that code on both
sides.

## The close grace: a bounded-cleanup contract

The grace has two values, each defined in one place:

- **The platform maximum.** `MAX_CLOSE_GRACE_MS` (2000 ms) is defined in
  `citadel-app-sdk-types/src/abi.rs`. It is re-exported by
  `citadel-workspace-types/src/apps_manifest_check_parts.rs`, and the browser imports it from
  the generated `AbiConstants`.
- **The app's own grace.** `AppLimits.close_grace_ms` is required in every manifest. Both
  manifest rule sets accept 1 to 2000 ms, and the shared cases in
  `apps/catalogue/fixtures/manifest-cases.json` pin 0, 2000 and 2001, and a manifest without the
  field. The host starts its grace timer from this value and gives the same value to the app.

The grace is the time an app is promised to finish what it holds. It is not a timeout to retry
after, and it does not stretch. Nothing is retried, and nothing outside `storage` and `log` is
reachable while closing, so a close cannot start new network work it might wait on. When the
grace runs out, the host ends the worker, whatever the app is doing. The `close-hang` fixture
proves this in both hosts.

## The browser host

### Starting and pausing

`AppInstance` (`host/instance.ts`) runs `app_init`. The zone runtime then starts the app
explicitly with `start()`, which delivers `AppEvent::Init`.

`zone-presence.ts` decides whether the instance should run. The page feeds it from the observers
in `zone-watchers.ts`:

- an IntersectionObserver on the zone;
- `visibilitychange`;
- `pagehide` with `persisted`, for the back/forward cache, and `pageshow`.

Out of sight, input is detached and the frame loop stops before `AppEvent::Suspend`. Back in
sight, `resume` comes first and then input reattaches. The page's own reason outranks the
zone's, so a zone back in view on a background tab stays suspended. A ResizeObserver resizes
the worker's bitmap and delivers `AppEvent::Resize`.

### Closing, in order

`close(reason)` is idempotent: every caller gets the same outcome promise, and the promise never
rejects. `runtime/zone-close.ts` does these steps in order:

1. **Quiesce.** The watchers stop, input detaches, and the frame loop stops. The handle stops
   forwarding inbound internal-HTTP frames.
2. **Cancel streams.** The worker cancels every internal-HTTP stream the instance serves and
   every call it made, with `Cancel {reason: "closed"}` (`ihttp-router.ts` `closeAll`). This
   happens first, not after the replies have settled. It is the only point at which it happens
   for sure, because a close that hangs would otherwise leave the streams open. The closing gate
   also means the app could not use them in `close` anyway.
3. **`app_close(reason)`.** The worker posts `closing` with the result.
4. **Settle.** The worker delivers every reply the close is waiting on. Once nothing is pending
   and nothing is queued, it posts `settled`.
5. **Terminate.** The handle terminates the worker as soon as one of these happens: it settles,
   the grace runs out, or the app traps. The worker's OffscreenCanvas goes with it, and the
   instance slot is released.
6. **Withdraw.** The renewal of the instance's advertisement stops. If it ever served, it is
   withdrawn (`WithdrawService`), including an advertisement that was still in flight.
7. **Release the canvas.** The canvas element is removed from the page.
8. **Drop ports.** Host egress streams are closed.
9. **Audit.** One audit line: app, install, zone, reason, how the close ended, the close result,
   the time it took, and the withdrawal.

| exit path | reason | how it ends |
|---|---|---|
| zone unmounted (navigation, edit) | `unmount` | the steps above |
| install removed, disabled for me, suspended | `uninstall` / `access_revoked` | the same, with the reason taken from the zone's next view (`app-zone/zone-close-reason.ts`) |
| a newer release or one waiting on consent | `version_update` | the same; the new release mounts in a fresh instance |
| `pagehide`, not persisted | `host_shutdown` | best effort: the page may be gone before the grace runs out |
| `pagehide`, persisted | none | suspended (`backgrounded`), resumed on `pageshow` |
| grace runs out | as asked | worker terminated; ends as `grace-expired` |
| trap or panic in `close` | as asked | ends as `trapped` |
| before `app_init` answered | as asked | ends as `not-started`, nothing to close |
| already stopped | as asked | answers at once with `already-stopped` |

The close reason is decided with no race, because of how React orders effects. `PlacedZone`
records the view it is about to show in a layout effect. Layout effects run in a commit's
layout phase. That is before the passive cleanup of the `RuntimeHost` the same commit removes
or replaces, and that cleanup is where the close is sent.
`app-zone/__tests__/zone-close-reason.test.tsx` proves this, and the test goes red when the
layout effect is made passive.

Failures are reported according to whether anyone is still there to act on them. On a live
page, a withdrawal the server refused is reported through `report`, and so is a close that
threw. On a page that is going away, nothing is reported, because the session the request
needed may already be gone. Nothing is caught without being either reported or attributed to
the page going away.

## The workspace server

- **Advertisements are kept per instance**
  (`citadel-workspace-server-kernel/src/kernel/apps/ihttp_adverts.rs`). One session may run
  several instances of one install, in two zones or two tabs, and one closing must not withdraw
  what the others still serve. A session advertises one install under at most 16 instance
  names, each 1 to 64 characters from `[A-Za-z0-9_-]`.
- **`WithdrawService {install_id, instance}`** answers `Withdrawn {closed_streams}`. When the
  session's last instance withdraws, the streams it served end, and their callers get
  `Cancel { Closed }` at once instead of waiting for a deadline
  (`command_processor/apps_ihttp_end.rs`).
- **When an install's release stops running**, its advertisements and relayed streams end, both
  ways, with the same cancel. That covers an uninstall, a rollback, an update that takes effect,
  and a consent.
- **An egress answer for an install that ended** while its request was out is withheld, with
  `{unavailable: "install_ended"}` (`command_processor/apps_call.rs`).
- **A stream past its deadline** is closed at the next relay request after the deadline passes,
  and both ends are sent `Cancel { Timeout }` (`ihttp_relay_end.rs` `expire`, settled in
  `apps_ihttp_end.rs` `with_relay`). The kernel has no timer of its own, so a relay that nobody
  uses closes nothing until it is next used; each host's own deadline covers that gap.
- **Every stream the relay opens or closes** is logged as one `[APPS-IHTTP]` audit line
  (`kernel/apps/ihttp_audit.rs`), with why it closed: `ended`, `cancel:<reason>`, `timeout`,
  `closed` or `session`.
- **Limitation: session end.** When a session ends, its advertisements and streams are dropped
  without telling the callers (`forget_session`, run when the session's relay handle drops). The
  stream leaves the relay at once, so the kernel never sends its surviving end a timeout; that
  end finds out at its own host's deadline.

## Proofs

Each guard below has a negative control. For each one, the defect was reintroduced, the named
test went red, and the file was restored to its exact earlier bytes.

- **Table and closing gate:** `citadel-app-sdk-types/tests/lifecycle.rs`.
- **Guest admission, a close runs once, and replies while closing:**
  `citadel-app-sdk/src/life_tests.rs`.
- **Close fixtures in both hosts:** `apps/sdk-fixtures`. The fixtures are:
  - `close-flush`: writes in `close`, is closed twice, and in one run is closed with a read
    still pending;
  - `close-hang`: never returns;
  - `close-panic`: panics in `close`;
  - `close-calls`: makes host calls after close began, and is sent events after close.

  They run in `harness/tests/run.rs` and in
  `citadel-workspaces/src/lib/citadel-apps/host/__tests__/sdk-fixtures.test.ts`.
- **Host handle:** `host/__tests__/instance-close.test.ts` covers every ending, idempotence, and
  refused steps. `instance-close-worker.test.ts` covers the reason codes, the gate, and settling
  after a reply. `instance-ihttp.test.ts` covers streams cancelled on close.
- **Zone runtime:** `runtime/__tests__/a-zone-runs-while-seen-and-closes.test.ts` and
  `zone-close.test.ts`.
- **Server:** `kernel_withdraw_tests.rs`, `ihttp_adverts_tests.rs`,
  `kernel_release_change_tests.rs`, `egress_in_flight_tests.rs`,
  `ihttp_relay_hardening_tests.rs` and `kernel_ihttp_hardening_tests.rs`.
- **Real browser:** `npm run check:app-zone`, lifecycle scenario. It checks:
  - scrolled away, it is suspended: no frame loop and no frames;
  - back in view, it runs;
  - with the page hidden, it is suspended;
  - removed from the page, its worker is terminated and no canvas or frame loop is left;
  - no frame arrives after removal;
  - one settled close is audited;
  - there are no console errors and no page errors.
