<p align="center">
  <img src="https://raw.githubusercontent.com/iplanwebsites/whyfull/main/assets/whyfull-banner.jpg" alt="whyfull scanning known developer clutter on a hard drive" width="100%">
</p>

# whyfull

Find the developer-tool clutter you can reclaim, without crawling your whole
drive or deleting anything for you.

```bash
npx whyfull
```

I built whyfull after repeatedly finding the same kinds of dead weight on my
own machine: model caches, package stores, browser binaries, simulator data,
container images, and build output. The space was recoverable, but discovering
it over and over with `du`, Finder, or an agent poking around at random was slow.

whyfull starts with a maintained map of the places developer tools tend to put
large files. It checks those known locations, measures what is actually there,
and ranks the results by how safe they are to reclaim. You get the appropriate
cleanup command or app instruction for each result. **whyfull never runs it.**

It is useful on its own in a terminal, and especially useful as a fast,
structured first step for a coding agent asked to free disk space.

## Why it is fast

The normal scan is intentionally narrow. It visits a few dozen high-value
locations for your operating system instead of recursively walking every file
under your home directory or disk.

1. Resolve the known locations for macOS, Linux, or Windows.
2. Measure only the ones that exist.
3. Account for allocated disk blocks and avoid double-counting hard links.
4. Rank every finding by deletion risk and show the tool-native reclaim action.

This is a map, not another cleanup implementation. Package managers, model
tools, and desktop apps already know how to clean up their own data safely;
whyfull helps you see which of them is worth opening first.

If the known map does not explain the missing space, `--discover` adds a bounded
scan of common user folders and reports unknown directories larger than 5 GB.
That mode is slower, but still more purposeful than a full-drive crawl.

## Read-only by design

There is no `--clean` flag. The scanner imports no filesystem write APIs, starts
no child processes, and makes no network requests. It only reports what it finds
and suggests the native cleanup command or app workflow.

Some recommendations still deserve judgement. An old model can be downloaded
again, but that may be expensive. A Photos library may be the only copy of your
data. That is why findings are grouped into explicit safety tiers instead of
being presented as one giant delete list.

> `npx` may download the npm package when it is not already cached. The whyfull
> process itself remains local and read-only.

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

| Command              | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `whyfull`            | Print the ranked report and drill into large known locations.   |
| `whyfull --json`     | Emit one machine-readable report and no presentation text.      |
| `whyfull --top 10`   | Show the ten largest children of each large target.             |
| `whyfull --no-drill` | Skip child breakdowns for the quickest known-location scan.     |
| `whyfull --exact`    | Fully count huge package stores instead of using a file budget. |
| `whyfull --discover` | Also look for unknown 5 GB+ directories in common user folders. |
| `whyfull --all`      | Include known locations that were not found.                    |
| `whyfull --help`     | Show command help.                                              |

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

The built-in map covers AI model stores, npm/pnpm/Yarn and other package caches,
Xcode and browser build artifacts, Docker and WSL data, application caches, and
large user-data locations that should be protected rather than deleted.

## JSON and programmatic API

`whyfull --json` is the interface intended for agents and automation. Each
target has a stable `id`, display metadata, resolved `path`, byte and file
counts, safety `tier`, reclaim `hint`, and flags for missing, denied, or partial
measurements. A partial byte count is a lower bound; use `--exact` when you need
the full count.

```js
import { byTier, human, render, scan } from "whyfull"

const report = scan({ top: 5 })

for (const tier of byTier(report)) {
  console.log(tier.label, human(tier.bytes))
}

console.log(render(report))
```

The package also exports `measure`, `volume`, `discover`, `TARGETS`, `TIERS`,
`TARGETS_RAW`, `forPlatform`, and the corresponding TypeScript types.

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
```

The monorepo uses pnpm and Turborepo. The npm package is in
[`packages/whyfull`](https://github.com/iplanwebsites/whyfull/tree/main/packages/whyfull).
Development currently requires Node 22.18 or newer; the published CLI supports
Node 18.15 or newer.

### README and publish-document contract

The root `README.md` is canonical. npm displays the copy in
`packages/whyfull/README.md`, so the two files are required to be byte-for-byte
identical.

Edit the root document, then mirror it with:

```bash
pnpm docs:sync
```

`pnpm docs:check`, the main `pnpm check`, CI, and the package's `prepack` hook
all fail when the copies drift. The same small script mirrors `LICENSE` and
`NOTICE` into the npm package so the published tarball contains its legal files.

## Native experiment

[`packages/whyfull-native`](https://github.com/iplanwebsites/whyfull/tree/main/packages/whyfull-native)
tracks an experimental standalone build using
[scriptc](https://scriptc.dev/). It is not part of the npm release. The normal
Node CLI remains the supported package.

## License

[Apache-2.0](https://github.com/iplanwebsites/whyfull/blob/main/LICENSE) © Felix
Menard.
