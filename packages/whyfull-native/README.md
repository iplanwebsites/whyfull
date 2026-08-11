# @whyfull/native

A standalone **native binary** of [whyfull](../whyfull) — no Node, no
JavaScript engine — compiled with [scriptc](https://scriptc.dev/).

> **Work in progress, currently blocked.** This package is not published to npm;
> it is distributed through a separate channel. The binary is not ready yet — see
> [Status](#status) below.

## Why a native build

The win here is **memory, and cold start**. On a large scan the native build
peaks around **3 MB RSS against ~61 MB** for the Node version, and starts far
faster. Wall-clock for the walk itself is about the same (~11.6s native, ~12.3s
Node): disk I/O dominates, so dropping the runtime lightens the process without
speeding up the scan. Reach for this build when RAM is the constraint.

The `whyfull` API compiles as-is. `Report` and everything in it is plain data
(epoch-ms numbers, no `Date` objects), so the native target needs no API changes.

## Status

scriptc 0.0.24 added the three `Stats` properties whyfull relies on: `blocks`
(allocated size, not apparent size), `nlink` (hard-link dedup), and `atimeMs`
(cache age). Coverage now completes with 201 of 237 statements (84%) compiling
statically.

That work was tracked in
**[scriptc#119](https://github.com/vercel-labs/scriptc/issues/119)**, now closed.
The binary is still a work in progress: `Dirent.name`, `fs.statfsSync`, and two
`StatsFs` fields remain unlowered, alongside several project-level static
compatibility fixes listed in [`scriptc_plan.md`](scriptc_plan.md).

Full technical notes — what already compiles, the remaining minor blockers, and
why alternatives like `Temporal` or flattening the API are the wrong fixes — are
in [`scriptc_plan.md`](scriptc_plan.md).

## Building and measuring

```bash
pnpm --filter @whyfull/native coverage     # analyze what compiles
pnpm --filter @whyfull/native build:native # produce the binary
```

The script is named `build:native` (not `build`) so turbo skips it while the
remaining compatibility work is in progress.

Measure with the real tool rather than reasoning about it — the compiler is
always more current than the notes.
