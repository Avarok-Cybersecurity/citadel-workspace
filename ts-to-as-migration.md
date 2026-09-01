# Migrating TypeScript to AssemblyScript — a scoping study

**Status:** scoping only. Nothing here has been implemented.
**Question asked:** now that the TypeScript is strongly typed everywhere, how much
of it can move to AssemblyScript?
**Short answer:** about a fifth of it *could*, roughly a twelfth of it *is worth
considering*, and the language already in this stack for that job is Rust.

---

## 1. The premise, examined

The reasoning behind the question is that AssemblyScript looks like TypeScript, so
a codebase with no `any` left in it should port mechanically.

That is worth stating plainly because it is the part that does not hold.
AssemblyScript is not a TypeScript compiler with a WASM backend. It is a separate
language with TypeScript-like *syntax* and substantially different *semantics*.
Strong type annotations are necessary for a port and nowhere near sufficient,
because the obstacles are runtime-shaped, not annotation-shaped:

| TypeScript feature this codebase uses | AssemblyScript |
| --- | --- |
| `async` / `await`, `Promise<T>` | No native support. This is the single largest blocker |
| Union types (`A \| B`, `string \| null`) | Not supported; nullability is expressed differently |
| Structural typing / interfaces as shapes | Class-based and far more nominal |
| Closures capturing arbitrary locals | Historically restricted; verify against the current release |
| `JSON.parse` into an arbitrary shape | No dynamic JSON; you write typed decoders |
| DOM, `window`, `localStorage`, IndexedDB | None. Everything crosses a host boundary by hand |
| `crypto.randomUUID`, `structuredClone` | Host imports you write and marshal yourself |

None of these are fixed by having removed `any`. A file can be perfectly typed and
still be unportable because it awaits something.

> AssemblyScript moves quickly, and several rows above have improved over
> releases. Before acting on this document, re-verify each against the version
> you would actually adopt rather than trusting this table.

---

## 2. What this codebase actually is

Measured on the production TypeScript in `citadel-workspaces/src`, excluding tests:

| Measure | Count |
| --- | --- |
| Production `.ts` / `.tsx` files | **868** |
| Total lines | **94,897** |
| `.tsx` (React components) | 244 |
| Files importing `react` | 247 |
| Files touching DOM / `window` / storage | 143 |
| Files using `async` / `await` / `Promise<T>` | **310** |

Then the subset that has none of those disqualifiers — no React, no async, no DOM,
no event bus:

| Measure | Count |
| --- | --- |
| Pure synchronous `.ts` modules | **271** |
| Their lines | **18,606** (19.6% of the codebase) |
| …of which are type-only (erased at compile time, nothing to port) | 47 |
| …of which contain real computation (loops, arithmetic, bitwise) | **71** |

So the honest ceiling is about **224 runtime modules and 18.6k lines, a fifth of
the product**, and the portion where a systems language would actually earn
anything is the **71 compute-bearing modules**.

The remaining 80% is not a matter of effort. React components cannot be written in
AssemblyScript at all, and 310 files await something. Those are permanent
exclusions, not backlog.

---

## 3. The question this raises first

**This repository already compiles a typed systems language to WebAssembly.**

| Measure | Count |
| --- | --- |
| Rust source files | 124 |
| Crates already building to WASM via `wasm-bindgen` | 3 |

`citadel-internal-service-wasm-client` is Rust compiled to WASM and called from
the browser today; `sync-wasm-clients.sh` and `docs/WASM_SYNC.md` exist to keep
those artefacts in step with the UI.

So for any module where the goal is "typed, fast, compiled to WASM", the choice is
not *TypeScript vs AssemblyScript*. It is *AssemblyScript vs the Rust toolchain
already in the build, already in CI, already understood by this team, and already
sharing types with the protocol layer through `ts-rs`*.

Adopting AssemblyScript would add a **third** language and a second WASM toolchain
to a project that has one of each. That cost should be paid only where Rust cannot
do the job, and no such case has been identified.

A concrete advantage of the Rust route specific to this codebase: the wire types
are generated from Rust by `ts-rs`. Logic ported to Rust can share those
definitions directly. Logic ported to AssemblyScript would need a third
hand-maintained copy of every shape it touches — and this campaign's own history
(rounds 463 and 466: reading fields off a wire message that did not declare them)
is a record of what happens when a type definition and its wire drift apart.

---

## 4. If it were pursued anyway: what would move

Ranked by suitability. All are in the pure-synchronous set and all are
compute-bearing.

### Tier 1 — genuine candidates

| Module | Lines | Why |
| --- | --- | --- |
| `lib/merkle-tree/tree.ts` | 210 | Hashing and tree comparison; pure arithmetic over byte arrays, the classic WASM case |
| `lib/revfs/tree-mutations.ts` | 210 | Pure tree transforms, data in / data out |
| `lib/revfs/tree-sync.ts` | 242 | Tree diff and merge; hot on large trees |
| `lib/call/send-encoder.ts` | 212 | Frame encoding on the media path, per-frame hot |
| `lib/call/media-pipeline.ts` | 189 | Same path, same argument |

That is roughly **1,060 lines**. It is the whole realistic first phase.

### Tier 2 — possible, weaker payoff

`lib/theme/palette-builder.ts` (239) and `lib/theme/presets.ts` (207) are pure and
sizeable, but they run once per theme change. Compiling them to WASM optimises
something nobody is waiting on.

### Explicitly out of scope, permanently

- All 244 `.tsx` components, and the 247 files importing React.
- The 310 files that await something: the RE-VFS service, the messenger, the
  connection layer, every storage path.
- Anything touching IndexedDB, `localStorage`, the WebSocket or the event bus.
- The 47 type-only modules: nothing to port, they vanish at compile time.

---

## 5. Costs that are easy to under-count

1. **The boundary is the work.** Every call from TypeScript into an AssemblyScript
   module marshals across a WASM boundary. For byte arrays that is a copy; for
   objects it is hand-written serialisation on both sides. A 210-line module can
   need comparable glue, and the glue is where a second source of truth for each
   shape appears.
2. **The test suite does not come with it.** There are 2,651 unit tests, and the
   ones covering ported modules would be rewritten against the boundary rather
   than the function. Coverage of the *logic* would drop until they are.
3. **The gates do not come with it either.** 75 preflight checks run against
   TypeScript. `check-explicit-types`, `check-cid-is-bigint`,
   `check-wire-fields-exist`, `check-success-flags-are-checked` and the rest parse
   `.ts` with the TypeScript compiler API and would be blind to `.as` sources.
   Ported code would leave the guarded region — which matters more here than in
   most codebases, given how many defects those gates have caught.
4. **CID handling would need re-proving.** CIDs are `bigint` throughout, and
   `check-cid-is-bigint` enforces it. AssemblyScript's `u64` is a different type
   with different overflow and conversion behaviour at every boundary crossing.
5. **A second WASM build in CI**, with its own cache, its own failure modes, and
   its own place in the `sync-wasm-clients.sh` ordering.

---

## 6. What would make this decision properly

No benchmark has been taken, and that is the gap worth closing before anything
else. The case for compiling any of this rests entirely on a claim — that these
modules are slow enough to matter — which nobody has measured.

Suggested order:

1. **Profile first.** Establish that `merkle-tree/tree.ts` or `revfs/tree-sync.ts`
   is actually hot on a realistic tree, with numbers. If they are not, the study
   ends here and that is a good outcome.
2. **If hot, port one to Rust**, which needs no new toolchain, and measure the
   same workload again. That gives a real number for the achievable win and costs
   days rather than weeks.
3. **Only if Rust proves unworkable for that module**, evaluate AssemblyScript
   against the same benchmark — with the boundary glue included in the
   measurement, since it is part of the cost.

Exit criterion for each step: a measured improvement large enough to justify the
extra toolchain, not a plausible one.

---

## 7. Recommendation

**Do not migrate the TypeScript to AssemblyScript.**

- Four-fifths of the codebase cannot move under any effort, because it is React,
  asynchronous, or bound to browser APIs.
- The fifth that could move is 18.6k lines, of which the part where a systems
  language earns anything is about 1,060 lines across five modules.
- For those five, this project already has Rust compiling to WASM, in CI, sharing
  generated types with the protocol — so AssemblyScript would be a third language
  solving a problem the second language already solves better here.
- No profiling has been done, so the performance premise is unverified.

**Worth doing instead:** profile the five Tier-1 modules. If any is genuinely hot,
port that one module to the Rust/WASM path that already exists. That captures
essentially all of the available benefit at a fraction of the cost, and adds no
new language to the build.
