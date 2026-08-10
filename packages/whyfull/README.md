# whyfull

Finds where disk space went on a dev machine (AI model caches, package stores,
build output) and ranks each finding by how safe it is to delete. Read-only: it
prints the reclaim command; you run it.

```bash
npx whyfull
```

```
  ███████████████████████████░  110.4 GB free of 3.63 TB  (97% used)
  Critically full. Deleting real files is the only fix at this level.

  Found 235.9 GB across 22 known locations · 204.3 GB safely reclaimable

  1. REGENERATES AUTOMATICALLY  17.9 GB — Safe. Rebuilt on next use, costs a re-download.
      ≥3.25 GB  pnpm store                     Package managers
                pnpm store prune  (drops only unreferenced packages)
       2.96 GB  pip cache                      Package managers
                pip cache purge

  3. JUDGEMENT CALL  167.5 GB — Safe to delete but slow to restore. Decide per item.
      86.0 GB  HuggingFace hub cache          AI models
      15.7 GB    ↳ models--black-forest-labs--FLUX.2-dev · used 3mo ago
                hf cache scan  (then: hf cache delete — revision-aware TUI)
      16.7 GB  LM Studio models               AI models
                Manage in LM Studio > My Models. No CLI.

  Read-only report. whyfull never deletes anything.
```

## Who this is for

**Coding agents, first.** An agent told to "free up space" needs a reliable map
before it touches anything. `whyfull --json` is that map: a stable,
machine-readable list of what's using disk and how risky each item is to remove,
each with a reclaim command to propose or run instead of guessing at `rm`.
whyfull only ever reads the filesystem, so pointing an agent at it is safe.

**Humans too.** The default output is a ranked report you can skim in a second.

## Why it exists

Every ecosystem already ships a good cleaner: `hf cache scan`, `ollama list`,
`docker system df`, `pnpm store prune`, [npkill](https://github.com/voidcosmos/npkill).
Use them; they know their own data best. What none of them give you is the total
picture. whyfull is the one command that shows a machine is sitting on 86 GB of
HuggingFace weights, 17 GB of LM Studio models, and 3 GB of pnpm store at once,
ranked against each other by deletion risk. It measures and ranks; the reclaim
work stays with the specialized tools.

## It never deletes anything

There is no `--clean` flag, by design. `hf cache delete` already does
revision-aware reference counting on model blobs; a reimplementation would only
find new ways to corrupt a cache. whyfull imports no write or spawn APIs — its
only filesystem calls are reads (`readdirSync`, `lstatSync`, `statSync`,
`statfsSync`, `existsSync`). It cannot modify the disk or reach the network.

## Usage

```
whyfull                 report, ranked, with a breakdown of the largest caches
whyfull --json          machine-readable output (see "JSON output" below)
whyfull --top 10        drill into the n largest children of big targets (default: 5)
whyfull --no-drill      skip the child breakdown (fastest)
whyfull --exact         count every file in huge package stores (slow, precise)
whyfull --all           also list locations that were not found
whyfull -h, --help      print usage and exit
```

Every flag is a plain boolean or takes one value — there's no subcommand tree.

### Exit codes

| Code | Meaning                                                                             |
| ---- | ---------------------------------------------------------------------------------- |
| `0`  | Report printed (or `--help` shown)                                                  |
| `2`  | Bad invocation — unknown flag, extra argument, or a non-numeric `--top`             |

A permission-denied location is reported in the output as an undercount, not
treated as failure — the exit code stays `0`.

## JSON output

`whyfull --json` prints one `Report` object and nothing else — safe to pipe into
`jq` or parse directly. This is the interface to build automation on.

```jsonc
{
  "platform": "darwin",
  "volume": { "total": 3996329328640, "free": 118548484096, "used": 3877780844544 },
  "targets": [
    {
      "id": "huggingface",              // stable key, safe to match on
      "label": "HuggingFace hub cache", // display name
      "group": "AI models",
      "tier": "JUDGEMENT",              // AUTO | REBUILD | JUDGEMENT | APP | DATA
      "hint": "hf cache scan  (then: hf cache delete — revision-aware TUI)",
      "path": "/Users/you/.cache/huggingface",
      "bytes": 92303937536,             // allocated blocks, not apparent size
      "files": 483,
      "present": true,                  // false when the location doesn't exist
      "denied": false,                  // true when it exists but couldn't be read
      "partial": false,                 // true when a file-count budget cut the walk short — bytes is a lower bound
      "children": []                    // largest subdirectories; empty unless --top > 0 and the target is large
    }
  ],
  "denied": 4,     // count of targets with denied: true
  "partial": 2,    // count of targets with partial: true
  "exact": false,  // whether --exact was used
  "total": 253309513728,
  "generatedAt": "2026-08-10T12:47:42.037Z"
}
```

`bytes: null` and `path: null` mean `present: false`: the location was checked
and doesn't exist. When `partial` is `true`, `bytes` is a **lower bound**, not an
extrapolated guess; re-run with `--exact` for the true figure. `hint` is the
reclaim command for a caller to surface or run.

## Safety tiers

Findings are ranked by deletion risk, not by size. A 60 GB Photos library and a
60 GB npm cache are the same size and nowhere near the same finding.

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

Runs on macOS, Linux, and Windows. Requires Node 18.15+. On macOS, TCC-protected
locations (Mail, Photos, iOS backups) are unreadable without Full Disk Access and
are reported as undercounts rather than shown empty.

## API

```js
import { scan, byTier, render, human } from "whyfull"

const report = scan({ top: 5 })
for (const tier of byTier(report)) {
  console.log(tier.label, human(tier.bytes))
}
```

## Native build

A standalone native binary (no Node runtime, ~3 MB peak RAM against ~61 MB) is in
progress, currently blocked upstream on
[scriptc#119](https://github.com/vercel-labs/scriptc/issues/119). It saves
memory rather than time; the scan is I/O-bound either way. See
[`packages/whyfull-native`](../whyfull-native) for details.

## Dependencies

Two runtime dependencies, both tiny and dependency-free:
[`mri`](https://github.com/lukeed/mri) for flag parsing and
[`picocolors`](https://github.com/alexeyraspopov/picocolors) for terminal colour,
under 15 KB unpacked combined. Colour is off unless stdout is a TTY, and always
off when `NO_COLOR` is set.

## License

Apache-2.0
