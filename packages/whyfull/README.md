<p align="center">
  <a href="https://github.com/iplanwebsites/whyfull">
    <img src="https://raw.githubusercontent.com/iplanwebsites/whyfull/main/assets/whyfull-banner.jpg" alt="whyfull scanning known developer clutter on a hard drive" width="100%">
  </a>
</p>

# [whyfull](https://github.com/iplanwebsites/whyfull)

Find the space your tools quietly consumed—without crawling your whole drive or
deleting anything for you.

```bash
npx whyfull
```

## Why it exists

I built whyfull while working with machine learning, where trying models across
different apps can quietly leave hundreds of gigabytes in unrelated folders.
The same problem appears in image, video, audio, and other media work through
render caches, sample libraries, generated assets, and downloads.

General disk tools tell you which files are large. whyfull starts with a shared
map of where popular tools tend to store them, then adds context: what created
the files, how safe they are to reclaim, and the appropriate cleanup command.
In the Unix tradition, it does one job and leaves the actual cleanup to the tool
that owns the data.

## Read-only by design

There is no `--clean` flag. whyfull only reads and reports, ranking disposable
caches separately from costly downloads and irreplaceable data. You decide what
to reclaim with the tool that created it. The only optional write is the report
file explicitly requested with `--json-file`; it never changes scanned data.

## Usage

No installation is required:

```bash
npx whyfull
```

Or install the command globally:

```bash
npm install --global whyfull
whyfull
```

| Command                           | What it does                                                    |
| --------------------------------- | --------------------------------------------------------------- |
| `whyfull`                         | Report known locations, untracked caches, and git worktrees.    |
| `whyfull --json`                  | Emit one machine-readable report and no presentation text.      |
| `whyfull --json-file report.json` | Save the JSON report without replacing an existing file.        |
| `whyfull --top 10`                | Show the ten largest children of each large target.             |
| `whyfull --no-drill`              | Skip child breakdowns for a quicker scan.                       |
| `whyfull --exact`                 | Fully count huge package stores instead of using a file budget. |
| `whyfull --discover`              | Also look for unknown 5 GB+ directories in common user folders. |
| `whyfull --no-cache-scan`         | Skip the default scan for unknown 250 MB+ user/project caches.  |
| `whyfull --no-worktrees`          | Skip the default git worktree scan.                             |
| `whyfull --worktree-age 7`        | Only show worktrees idle for at least seven days.               |
| `whyfull --all`                   | Include known locations that were not found.                    |
| `whyfull --help`                  | Show command help.                                              |

The command exits with `0` after a report or help output, and `2` for an invalid
option or value. Permission-denied locations are marked as undercounts in the
report rather than treated as a failed run.

## Safety tiers

| Tier                          | Meaning                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| 1 · regenerates automatically | Safe to rebuild on next use; usually costs a download.          |
| 2 · rebuildable               | No source data is lost, but rebuilding costs CPU time.          |
| 3 · judgement call            | Removable, but slow or expensive to restore. Decide per item.   |
| 4 · app-managed               | Quit or use the owning app so it does not immediately recreate. |
| 5 · real data                 | May be the only copy. Never bulk-delete it.                     |

The built-in map covers AI model stores, npm/pnpm/Yarn and other package caches
(including pnpm's separate store, cache, Node runtime, and global-install
sub-trees), Xcode and browser build artifacts, Docker and WSL data, application
caches, AI coding agent app data (Codex, Claude Code, Cursor, and friends), and
large user-data locations that should be protected rather than deleted.

## JSON and programmatic API

`whyfull --json` is the canonical interface for agents, automation, and future
renderers. `--json-file <path>` saves that same payload with owner-only file
permissions and refuses to overwrite an existing report:

```bash
npx --no-install whyfull --json-file ./whyfull-report.json
```

The payload has `format: "whyfull-report"` and a numeric `schemaVersion` so a UI
can evolve independently from the terminal renderer. It includes scan options,
runtime and timing metadata, tier definitions, lower-bound summaries, the full
known-target measurements, untracked cache results, and worktree clusters.
Worktree entries retain exact ISO dates and raw Git HEAD/index/gitdir mtimes,
the timestamp source, apparent and non-shared byte counts, state/tool/branch
metadata, and structured recommendations with review and Git-safety flags.
On macOS, worktree cleanup recommendations are Trash-first: they use the system
`/usr/bin/trash`, preserve the branch, and only then prune stale Git metadata.

“Last activity” is the newest Git worktree-admin HEAD or index modification. It
is a useful Git-activity proxy, not filesystem access time and not proof that an
agent task is finished. A partial byte count is a lower bound; use `--exact`
when you need the full count. Report files contain absolute local paths, so
handle them as private machine inventory.

```js
import { buildJsonReport, byTier, human, render, scan } from "whyfull"

const report = scan({ top: 5 })

for (const tier of byTier(report)) {
  console.log(tier.label, human(tier.bytes))
}

console.log(render(report))

const data = buildJsonReport({
  report,
  durationMs: 0,
  options: {
    top: 5,
    showAll: false,
    exact: false,
    discover: false,
    cacheScan: false,
    worktrees: false,
    worktreeRoots: [],
    worktreeAge: 0,
  },
})
```

The package also exports `measure`, `measureSimulatorRuntimes`, `volume`,
`discover`, `discoverCaches`, `findWorktrees`, `buildJsonReport`,
`saveJsonReport`, `JSON_SCHEMA_VERSION`, `TARGETS`, `TIERS`, `TARGETS_RAW`,
`forPlatform`, and the corresponding TypeScript types.

## Add a private target

You can extend the built-in map without forking the project. Create
`~/.config/whyfull/targets.json`:

```json
[
  {
    "id": "kontakt",
    "label": "Kontakt libraries",
    "group": "Music production",
    "tier": "DATA",
    "paths": {
      "darwin": ["~/Library/Application Support/Native Instruments"],
      "linux": [],
      "win32": []
    },
    "hint": "Manage in Native Access. Sample libraries are data, not a cache."
  }
]
```

Custom entries merge with the built-in targets at runtime. Invalid config is
ignored so a typo cannot prevent the normal report from running. Paths may use
`~/` or a leading environment variable such as `$HF_HOME`.

## Contributing new locations

This project gets more useful when developers contribute the bulky locations
they have already had to track down. If a tool regularly leaves gigabytes in a
predictable place, please share it.

The quickest route is to
[open a target suggestion](https://github.com/iplanwebsites/whyfull/issues/new)
with:

- what creates the directory;
- its path on each operating system you can verify;
- how the owning tool recommends reclaiming it;
- which safety tier fits, and why;
- a documentation link when one exists.

For a pull request, add the entry to
[`packages/whyfull/src/targets-data.ts`](https://github.com/iplanwebsites/whyfull/blob/main/packages/whyfull/src/targets-data.ts).
Keep target IDs stable, prefer the owning tool's cleanup command over a generic
`rm`, and leave unsupported operating-system path arrays empty. Then run:

```bash
pnpm install
pnpm build
pnpm check
```

Small corrections are just as welcome as new targets. Paths and cleanup advice
change over time, so a verified fix is valuable.

## Development

The public repository is
[`iplanwebsites/whyfull`](https://github.com/iplanwebsites/whyfull).

```bash
git clone https://github.com/iplanwebsites/whyfull.git
cd whyfull
corepack enable
pnpm install
pnpm build
pnpm check
pnpm whyfull
```

The monorepo uses pnpm and Turborepo. The npm package is in
[`packages/whyfull`](https://github.com/iplanwebsites/whyfull/tree/main/packages/whyfull).
The root workspace links that package locally, so `npx --no-install whyfull`
also runs this checkout's built CLI and cannot fall back to the hosted package.
Development currently requires Node 22.18 or newer; the published CLI supports
Node 18.15 or newer.

## Native experiment

[`packages/whyfull-native`](https://github.com/iplanwebsites/whyfull/tree/main/packages/whyfull-native)
tracks an experimental standalone build using
[scriptc](https://scriptc.dev/). It is not part of the npm release. The normal
Node CLI remains the supported package.

## License

[Apache-2.0](https://github.com/iplanwebsites/whyfull/blob/main/LICENSE) © Felix
Menard.
