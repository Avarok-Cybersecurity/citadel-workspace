#!/bin/bash
# One annotation per file per pass, judged by the compiler, repeated.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v22.16.0/bin:$PATH"
for pass in $(seq 1 "${1:-6}"); do
  # Count from the baseline file, not from a message. The first version read
  # "N in the baseline" out of the gate's OK line, which the gate does not print
  # when it is failing -- so a failing gate read as zero and the loop reported
  # the work finished.
  before=$(python3 -c "import json;print(sum(json.load(open('scripts/explicit-types.baseline.json')).values()))")
  node scripts/annotate-from-findings.mjs src --allow-literal --any-as-unknown --widen-strings --one-per-file >/dev/null 2>&1
  for round in 1 2 3; do
    BAD=$(npx tsc -p tsconfig.app.json --noEmit 2>&1 | sed -n 's/^\(src\/[^(]*\)(.*/\1/p' | sort -u)
    [ -z "$BAD" ] && break
    # Remember every site in a rejected file, so the next pass reaches the ones
    # behind it instead of proposing the same failure again.
    # Only the files this pass touched: errors cascade, and reverting every
    # file named in them threw away work in files never edited.
    OURS=$(python3 scripts/record-rejected.py "$BAD")
    [ -z "$OURS" ] && break
    echo "$OURS" | xargs git checkout --
  done
  node scripts/merge-type-imports.mjs >/dev/null 2>&1
  npx eslint --fix src >/dev/null 2>&1
  node scripts/check-explicit-types.mjs --write --allow-regressions >/dev/null 2>&1
  after=$(python3 -c "import json;print(sum(json.load(open('scripts/explicit-types.baseline.json')).values()))")
  # Commit each pass. `git checkout --` reverts to HEAD, so without this a later
  # pass's revert threw away every earlier pass's work on that file -- the count
  # went 666, 663, 660, 666, 663, 660, 666 and never finished.
  if [ "$after" -lt "$before" ]; then
    git add -A && git commit -q -m "refactor: typing pass -- $before to $after"
  fi
  echo "pass $pass: $before -> $after"
  # Keep going while there is anything left to TRY, not while the count is
  # falling. A pass whose every proposal is rejected makes no progress and is
  # still useful: it puts those sites in the ledger, so the next pass reaches
  # the ones behind them. Stopping on a flat pass stopped the whole loop after
  # one round, every time.
  remaining=$(node scripts/annotate-from-findings.mjs src --allow-literal --any-as-unknown --widen-strings --one-per-file --dry 2>/dev/null | grep -oE 'annotate [0-9]+' | grep -oE '[0-9]+')
  [ "${remaining:-0}" = "0" ] && break
done
