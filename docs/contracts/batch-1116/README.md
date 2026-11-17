# Batch-1116 contracts (plan §5 + §9a as machine-checkable artefacts)

Gate: `node scripts/check-batch-contracts.mjs` (CI `crate-coverage` job; no dependencies). It
validates every `fixtures/<schema>/valid-*.json` against `<schema>.schema.json`, requires every
`invalid-*.json` to be refused, round-trips every CBOR fixture through a canonical decoder and
encoder, and recomputes every known-answer value Node can derive. An unknown field anywhere is a
refusal (`deny_unknown_fields`), and a fixture directory with no valid or no invalid file fails.

| contract | files | built by |
|---|---|---|
| Identity crate API, derivations, blobs | `identity-api.md`, `identity-kat.json` | I1 (crate), I2, I3, I5, S1 |
| `/.well-known/citadel` (`citadel` optional: an issuer-only server such as work.avarok.net has none) | `well-known-citadel.schema.json`, `fixtures/well-known-citadel/` | I3, I4, S2 |
| Post-connect server identity challenge | `server-identity-challenge.md` | I2, I3 |
| Sign in with Citadel (D-B), incl. the identity proof (§1a, §7, §8; design `SIGN-IN-IDENTITY-PROOF.md`) | `sign-in-with-citadel.md`, `sign-in-with-citadel.schema.json`, `fixtures/sign-in-with-citadel/`, `sign-in-kat.json` | I5 (page), I4 (issuer, control-host identity), I2 (agent `IdentitySignChallenge`), I1 (crate §7a), S3, S4, S2 |
| CW-6 `citadel.session` | `citadel-session-abi.md` | H2, S6 |
| CW-1..3 `node_page` | `node-page-abi.md`, `node-page-envelope.schema.json`, `fixtures/node-page-envelope/` | H1, S6 |
| CW-5 canvas extension | `canvas-ext-abi.md` | H3, S1 |
| Tray tab + update manifests | `tray-tab-manifest.md`, `tray-tab-manifest.schema.json`, `update-manifest.schema.json`, `fixtures/tray-tab-manifest/`, `fixtures/update-manifest/`, `tray-tab-kat.json` | T1, T2, T3 |
| synchronized.work wire | `sw-wire.md`, `fixtures/sw-wire/`, `sw-wire-kat.json` | S1, S2, S4, S5, S6 |

Test material: every key here is expanded from a published seed (`identity-kat.json`
`identities.*.seed_hex`, `servers.*.key.seed_hex`, `sw-wire-kat.json`, `tray-tab-kat.json`).
None of them is, or may ever become, a production key.

Changing a frozen contract: change the file, regenerate or edit the fixtures, run the gate, and
tell every lane in the "built by" column in the same message as the commit.
