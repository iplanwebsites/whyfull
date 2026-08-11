# scriptc Compatibility Plan

## Goal

Compile whyfull to a standalone native binary using [scriptc](https://scriptc.dev/) —
no Node/Bun runtime required. A hello-world binary is ~320KB.

The user-facing summary of this effort — the RAM-vs-speed trade and the current
blocker — lives in [`README.md`](README.md). This file is the working detail.

## Status

`ScannedTarget[]` now compiles. The public API is unchanged.

With scriptc 0.0.24, coverage analyzes 237 statements and compiles 201 (84%)
statically. A fully static binary does not build yet.

Measure with the real tool rather than reasoning about it — the compiler is
always more current than this document:

```bash
pnpm --filter @whyfull/native coverage   # scriptc coverage ../whyfull/src/cli.ts
```

## Resolved

**`Stats.blocks`, `Stats.nlink`, and `Stats.atimeMs` are supported in scriptc
0.0.24.** This fixes the type-surface gap tracked in
[scriptc#119](https://github.com/vercel-labs/scriptc/issues/119) and lets
coverage analyze the whole program instead of stopping at typecheck.

**`ChildEntry.atime: Date | null` → `atimeMs: number`** (-1 when unavailable).

This was the _only_ thing blocking `ScannedTarget[]`, and through it `Report`.
`Date` compiles in a restricted form (construction, `getTime`, `toISOString`,
calendar getters) but **not as a union arm** — there is no runtime narrowing test
against sibling arms. The nullable union was the blocker, not `Date` itself.

Worth doing regardless of scriptc: `Date` does not survive
`JSON.parse(JSON.stringify())`, so the report is now genuinely round-trippable.

## Corrections to the previous revision

That revision named three blockers. Two were not real, and the third was
misdiagnosed. Verified with `scriptc coverage` on minimal probes:

| Claim                                                 | Reality                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Set<string>` blocks compilation                      | **False.** `Set` compiles; keys may be strings or numbers. The real (minor) blocker is `MeasureOptions.seen?: Set<string>` — an _optional_ Set, i.e. a union with `undefined`. |
| Optional/nullable/nested fields block records         | **False.** All three compile. A probe with `bytes: number \| null`, `files?: number`, and `children: C[]` reported 21/23 static; the only blocker was the `Date` union.        |
| `ScannedTarget[]` needs flattening to parallel arrays | **Unnecessary.** The full shape — nullable, optional, and nested-array fields intact — compiles at 100% static once `atime` becomes a number.                                  |

**Do not flatten the API.** Options A and B in the previous revision would have
broken the public interface to solve a problem that did not exist.

## Remaining blockers

None require API changes. Roughly in order of effort:

- **`Number.parseInt`** (SC2012) — one call site in `cli.ts`.
- **`MeasureOptions.seen?: Set<string>`** (SC2009) — the optionality, not the
  `Set`. Pass a required `Set` and let callers hand in an empty one.
- **Object spread after explicit properties** (SC1090) — spreads must come first.
- **Logical operators on mixed operand types** (SC1042) — ×2.
- **Callback returning `number | false | null`** (SC2011) — narrow the return type.
- **Unlowered `@types/node` surface** (SC2020) — `fs.statfsSync`, `StatsFs.blocks`,
  `StatsFs.bavail`, and `Dirent.name`. These need upstream lowerings or an
  FFI/`--dynamic` escape hatch; `volume()` and discovery are the main casualties.

## Notes for whoever picks this up

- Coverage only analyzes programs that **typecheck**, in scriptc's own type world
  (`es2025` + its ambient declarations, with deliberate tightenings — e.g.
  `JSON.parse` returns `unknown`, `pop()` returns `T`).
- **Temporal is not an option.** scriptc's type world has no `Temporal` namespace
  (`SC0001`), so it fails before tier analysis; Node 22 has no global `Temporal`
  either. It would add a polyfill dependency to a zero-dependency package and
  raise `engines.node`. Epoch-ms numbers are the shape that compiles.
- Arrays are **dense** — out-of-bounds reads trap rather than yielding
  `undefined`, and the trap is not catchable. `process.argv[2]` needs an explicit
  length check. Worth auditing `cli.ts` before a real build.
- `--dynamic` embeds a JS engine (~620KB) and is opt-in; static is the default.
- Statement counts rise as blockers clear — unblocking `Report` took the analyzed
  count from 79 to 179, so the headline percentage understates progress.
