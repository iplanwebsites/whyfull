# whyfull

Finds where disk space went on a dev machine (AI model caches, package stores,
build output) and ranks each finding by how safe it is to delete. Read-only: it
prints the reclaim command; you run it.

```bash
npx whyfull
```

```
  ███████████████████████████░  125.6 GB free of 3.63 TB  (97% used)
  Critically full. Deleting real files is the only fix at this level.

  Found 235.0 GB across 27 known locations · 231.8 GB safely reclaimable

  1. REGENERATES AUTOMATICALLY  45.3 GB — Safe. Rebuilt on next use.
      ≥26.1 GB  pnpm store                     Package managers
                pnpm store prune  (drops only unreferenced packages)

  3. JUDGEMENT CALL  167.5 GB — Safe to delete but slow to restore.
       86.0 GB  HuggingFace hub cache          AI models
       15.7 GB    ↳ models--black-forest-labs--FLUX.2-dev · used 3mo ago
                hf cache scan  (then: hf cache delete — revision-aware TUI)
       16.7 GB  LM Studio models               AI models
                Manage in LM Studio > My Models. No CLI.
```

## Who it's for

Built for **coding agents** first. `whyfull --json` is a stable, read-only report
of what's using disk and how risky each item is to remove, each with its reclaim
command, so an agent told to free up space has a reliable map before it touches
anything. It's just as handy for **humans** who want to see at a glance what's
eating the disk.

Every ecosystem already ships a good cleaner (`hf cache scan`, `docker system
df`, `pnpm store prune`); what none of them give you is the total picture, ranked
by deletion risk. whyfull measures and ranks. It prints the command; it never
runs it, and it makes no write, spawn, or network calls at all.

## Packages

| Package | What it is |
| --- | --- |
| [`packages/whyfull`](packages/whyfull) | The CLI and programmatic API, published to npm. **Full usage, flags, and JSON output are documented in its [README](packages/whyfull/README.md).** |
| [`packages/whyfull-native`](packages/whyfull-native) | Work-in-progress native binary (via [scriptc](https://scriptc.dev/)) — lighter on RAM, not published to npm. Currently blocked upstream. |

## Development

```bash
pnpm install
pnpm build      # build all packages
pnpm test       # run the test suite
pnpm typecheck
```

pnpm workspace + Turborepo. The published package lives in
[`packages/whyfull`](packages/whyfull); start there.

## License

Apache-2.0
