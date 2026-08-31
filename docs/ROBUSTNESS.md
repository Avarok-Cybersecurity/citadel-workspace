
## Round 504 — a lost SyncResponse stranded the peer for ever

**Found.** `Integration Test - test:file-manager`, `Peer Sees File: FAIL`. The CI log
showed the same SyncRequest op id arriving roughly once a second for the whole
test, every one logged `already applied`, every one answered with silence, while
the file it was syncing never appeared.

**Cause.** `revfs-inbound`'s duplicate guard re-acknowledges duplicates for the
reason its own comment gives — "a receiver that has already applied it and stays
silent leaves that sender retrying for ever" — but excluded `SyncRequest`,
because an Ack is the wrong shape for a query. So a peer whose SyncResponse was
lost re-asked for ever and was told nothing. The fix that comment describes was
never propagated to the one op type that needed a different answer, not no answer.

**Fix.** Both the fresh and the repeated request now route through one
`answerSyncRequest` helper. A fresh request is always answered and records the
time; a repeat is re-answered at most once per peer per 2s
(`sync-answer-rate.ts`). Answering every repeat is not the fix — that is the
flood the dedupe was added for (seven requests, one hundred handled, a hundred
564-byte trees starving the PlaceFile behind them).

**What the design cost me.** My first version gated only the repeat path. Two
pre-existing tests caught it: a same-instant burst got two full trees, because
the fresh answer bypassed the limiter and so the first redelivery looked like a
new window. My second version gated both paths uniformly — and that broke the
other pre-existing test, `still answers a genuinely new SyncRequest`, which is
the positive control proving the dedupe has not degenerated into total silence.
Both tests were right. The contract that satisfies both is the split one above:
fresh always answers but stamps, only repeats are gated. I came close to
loosening a correct assertion to fit a design that was wrong.

**Controls.** Three, each red on the specific test that should catch it:
answering repeats with silence reddens `answers a repeat that arrives after the
interval`; answering every repeat reddens the burst test and the pre-existing
`once, not twice`; dropping the fresh-path stamp reddens both of those too.

**Gate.** `npm run preflight` — all 75 checks pass.
