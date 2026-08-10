# yful

Report where disk space went on a developer machine. Read-only, zero dependencies.

```bash
npx yful
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
       13.8 GB    ↳ models--microsoft--TRELLIS.2-4B · used 3mo ago
                hf cache scan  (then: hf cache delete — revision-aware TUI)
       16.7 GB  LM Studio models               AI models
                Manage in LM Studio > My Models. No CLI.
```

## Why

Every ecosystem already ships a good cleaner — `hf cache scan`, `ollama list`,
`docker system df`, `pnpm store prune`, [npkill](https://github.com/voidcosmos/npkill).
Each is better at its own job than a reimplementation would be. What is missing
is the _aggregate_: nothing tells you that a machine is holding 90 GB of
HuggingFace weights, 17 GB of LM Studio models, and 2 GB of Ollama blobs at the
same time, ranked against each other by how safe each is to remove.

That gap is the whole point of this tool. It measures, ranks, and prints the
command you should run. It does not run it.

## It never deletes anything

There is no `--clean` flag and there will not be one. `hf cache delete` already
does revision-aware blob reference counting; reimplementing that is how you
corrupt someone's model cache. yful imports no write or spawn APIs from
`node:fs` at all — the only filesystem calls are `readdirSync`, `lstatSync`,
`statSync`, `statfsSync`, and `existsSync`.

## Usage

```
yful                 report, with a breakdown of the largest caches
yful --json          machine-readable
yful --top 10        drill deeper into big targets
yful --no-drill      skip the breakdown (fastest)
yful --exact         count every file in huge package stores (slow)
yful --all           also list locations that were not found
```

## Safety tiers

Findings are ranked by how safe removal is, not by size — a 60 GB Photos
library and a 60 GB npm cache are not the same finding.

| Tier                          | Meaning                                      |
| ----------------------------- | -------------------------------------------- |
| 1 · regenerates automatically | Rebuilt on next use. Costs a re-download.    |
| 2 · rebuildable               | Costs CPU time. No data lost.                |
| 3 · judgement call            | Safe, but slow to restore. Decide per item.  |
| 4 · app-managed               | Quit the app first or it rewrites the cache. |
| 5 · real data                 | May be the only copy. Never bulk-delete.     |

## What it knows about

**AI models** — HuggingFace, Ollama, LM Studio, PyTorch hub, Whisper
**Package managers** — npm, pnpm, Yarn, pip, uv, conda, Cargo, Go, Gradle, Homebrew
**Build output** — Xcode DerivedData / DeviceSupport / Simulators, Playwright, Puppeteer, Electron
**Containers** — Docker VM image, WSL2 virtual disks
**App caches** — Spotify, Adobe Camera Raw, VS Code
**User data** (flagged, never recommended for deletion) — Photos, Mail, iOS backups, Trash

Adding a location means adding an entry to [`src/targets.js`](src/targets.js).

## Accuracy notes

Sizes are **allocated blocks** (`st.blocks * 512`), not apparent size, so
Docker's sparse 63 GB VM image reports what it actually costs. Hard-linked
inodes are counted once per scan, which matters because pnpm stores and HF
blob directories are mostly links — naive counting inflates them severalfold.
Symlinks are never followed.

Cost tracks **inode count, not bytes**: a 92 GB model cache of 483 large files
measures in 0.04s, while a 28 GB pnpm store of 633k tiny files takes 80s. Those
stores are capped by a file budget and shown as `≥26.1 GB`. A truncated walk is
always reported as a lower bound — it never extrapolates a total, because a
confidently wrong number is worse than an honest floor. `--exact` lifts the cap.

On macOS, Mail, Photos, and iOS backups are TCC-protected and unreadable
without Full Disk Access. yful reports how many locations it could not read
rather than letting them appear as empty.

## Platforms

macOS, Linux, and Windows. Paths come from a per-platform table; Windows uses
`%LOCALAPPDATA%` / `%APPDATA%` and adds WSL2 virtual disks, which are frequently
the largest single item on a Windows dev machine. Volume capacity uses
`fs.statfsSync`, so there is no `df` or PowerShell parsing.

Requires Node 18.15+ (`fs.statfsSync`).

## API

```js
import { scan, byTier, render, human } from "yful"

const report = scan({ top: 5 })
for (const tier of byTier(report)) {
  console.log(tier.label, human(tier.bytes))
}
```

## License

MIT
