# Gates

84 `check-*.mjs` scripts: 44 here, 40 in `citadel-workspaces/scripts/`. Each
encodes one property that was violated at least once, usually more than once in
different files — which is why it is a check rather than a fix.

`npm run preflight` runs the set. Its list is **derived** from
`.github/workflows/validate.yml`, so adding a step there is what makes preflight
run it, and the two cannot drift.

## Adding one

1. Write it. Exit non-zero on failure, and name the file and line.
2. Invoke it. `check-every-gate-is-invoked.mjs` enforces this, and exists
   because `check-submodule-pointers-pushed.mjs` was written, was correct, and
   had never run once — a whole CI run died in checkout for the condition it
   detects, while the detector sat in the same directory. **A gate that runs
   nowhere looks identical to a gate that passes.**
3. Control it. See below.

## Controlling it

Plant the violation the gate exists to catch, and watch it fail. A green control
means the gate is measuring nothing — and that is worse than no gate, because it
carries a claim of verification.

Six ways a control silently passes while measuring nothing, all observed in this
repo:

| The control | What happened |
|---|---|
| Patched a string that appears in a **doc comment** first | The prose changed, the code did not |
| Used an anchor that does not match | `str.replace` says nothing when it matches nothing |
| Planted in a file the gate **does not scan** | Several gates check named files, not a tree |
| Planted the wrong **shape** | `check-storage-keys` wants a key that is READ and never written; an unread one is a different defect |
| Read the exit code through a pipe | `node gate.mjs \| head` reports **head's** status |
| Let the shell eat the argument | An unquoted `--include=*.ts` expands in zsh; the target came back empty and the gate "passed" against an unmodified tree |

The defence is mechanical: **make the planting step print what it changed, and
read that before reading the verdict.** Every one of the above was caught that
way, or missed because it was not done.

```bash
node scripts/check-<name>.mjs > /dev/null 2>&1; echo "exit: $?"   # not through a pipe
```

## Where the failures are recorded

`docs/ROBUSTNESS.md` — what was found, the evidence, and what each control
proved. Including the controls that proved nothing, which are the useful half.
