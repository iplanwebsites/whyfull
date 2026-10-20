<p align="center">
  <a href="https://whyfull.app/">
    <img src="https://raw.githubusercontent.com/iplanwebsites/whyfull/main/assets/whyfull-banner.jpg" alt="whyfull scanning known developer clutter on a hard drive" width="100%">
  </a>
</p>

# [whyfull](https://whyfull.app/)

**Your disk called. It wants its space back.**

That model you tried once. The Docker cache from three projects ago. The worktree
your coding agent left behind. It all adds up.

Whyfull finds the tools quietly filling your drive and explains **what created
the data, what it costs to remove, and how to reclaim it**. One report, ready for
you or your coding agent.

**[Download the app](https://whyfull.app/download/)** ·
[Visit the website](https://whyfull.app/) · [Give it to your agent](#bring-your-coding-agent)

Free and open source. Scans run locally. No automatic deletion.

## Find out where it went

Run a report in your terminal:

```bash
npx whyfull
```

You’ll get sizes, safety tiers, and tool-specific cleanup guidance for known
locations, discovered caches, and Git worktrees. Start with the biggest useful
opportunities instead of guessing which mysterious folder can go.

Requires [Node.js](https://nodejs.org/) 18.15 or newer. No global install needed.

**Prefer to click around? [Download the desktop app](https://whyfull.app/download/).**
Explore your disk visually without installing Node.js. The download page lists
published installers and standalone CLI archives, with setup instructions.
If a desktop release isn’t available yet, use the command above.

## Find it. Understand it. Clear it.

1. **Find the space hogs.** Spot bulky models, caches, build leftovers, and
   forgotten worktrees in one report.
2. **See what’s worth clearing.** Learn what created each folder and whether
   removing it means a quick download, a long rebuild, or losing real data.
3. **Reclaim space on your terms.** Follow the owning tool’s cleanup guidance
   yourself, or have your coding agent work through the findings with you.

A big folder isn’t automatically disposable. Whyfull helps you make that call;
measured usage isn’t a promise of reclaimable space. Scanning doesn’t delete
anything, and viewer cleanup starts in demo mode.

### The usual suspects

| Where the space goes         | What Whyfull looks for                                      |
| ---------------------------- | ----------------------------------------------------------- |
| Models you meant to try      | Ollama, LM Studio, Hugging Face, PyTorch, and Whisper       |
| Packages that keep piling up | npm, pnpm, Yarn, pip, uv, Cargo, and Homebrew               |
| Builds with a long memory    | Xcode DerivedData, iOS Simulators, Playwright, and Electron |
| Containers with baggage      | Docker VM images and WSL2 virtual disks                     |
| Agents and their leftovers   | Codex, Claude Code, Cursor, Windsurf, and Git worktrees     |
| Everyday app clutter         | Adobe Camera Raw, Spotify, Chrome, and VS Code              |

Some of these locations hold settings, offline downloads, or work you still
need. The report adds context so you can tell the difference.
[See all supported locations](https://github.com/iplanwebsites/whyfull/blob/main/packages/whyfull/src/targets-data.ts).

## Follow the space

Open the local disk viewer from your terminal:

```bash
npx whyfull ui
```

Explore folders as nested rings in the **sunburst**, or compare their sizes at a
glance in the **treemap**. Click into the biggest pieces, search the file list,
and mark folders to keep or exclude. The desktop app includes the same viewer.

The report starts with known tool locations; the viewer lets you explore a whole
drive or a folder of your choice. `npx whyfull --view` and `npx whyfull app` also
open the viewer.

## Bring your coding agent

Give your agent a measured report to investigate:

```bash
npx whyfull --json
```

Or install the Whyfull skill and choose your agent:

```bash
npx skills add iplanwebsites/whyfull --skill whyfull
```

Then ask:

> Help me reclaim disk space with Whyfull. Find the biggest useful cleanup
> opportunities, explain what I’d be removing, and propose a plan before cleanup.

The skill helps your agent interpret sizes and safety tiers, investigate
worktrees, and choose the owning tool’s cleanup method. Reports can contain
private local paths; choose what you share with your agent.

[Read the skill](https://github.com/iplanwebsites/whyfull/blob/main/skills/whyfull/SKILL.md).

## Why it exists

I built whyfull while working with machine learning, where trying models across
different apps can quietly leave hundreds of gigabytes in unrelated folders.
The same problem appears in image, video, audio, and other media work through
render caches, sample libraries, generated assets, and downloads.

General disk tools tell you which files are large. whyfull starts with a shared
map of where popular tools tend to store them, then adds context: what created
the files, how safe they are to reclaim, and the appropriate cleanup command.
The report provides cleanup commands for the tools that own the data; the viewer
also supports explicit macOS Trash moves.

## Command reference

If you use Whyfull often, install the command globally:

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

## Viewer and scanner details

Switch between a **sunburst** (concentric folder rings) and **treemap**, with
breadcrumbs and a searchable list of the largest pieces on the right. Click
folders to explore while the scan runs. All viewer assets are bundled and work
offline; the authenticated server binds only to `127.0.0.1` on a random port.

```bash
whyfull --view --root ~/Library --workers 4
whyfull --view --exclude ~/Pictures --exclude ~/Music
whyfull --scan --root ~/Downloads --json-file disk.json
whyfull --view --snapshot disk.json
whyfull --view --report caches.json
# From the workspace runner:
pnpm viewer --report caches.json
```

On macOS, the default root is `/System/Volumes/Data`; elsewhere it is the system
drive root. Scanning stays on one filesystem, skips symlinks, reads metadata
only, and reports inaccessible locations as undercounts. macOS-protected
locations may require Full Disk Access for the launching terminal. Ctrl+C stops
the viewer and its workers. Nothing leaves your computer. Cleanup starts in demo mode.

In folder details, **Keep** leaves sizes visible and suppresses cleanup advice.
**Exclude** skips the folder and its descendants on future scans; its size is
unknown. Manage saved rules in **Keep & exclude rules**. Pause and rescan to apply
changed exclusions. Preferences are stored privately in
`~/.config/whyfull/config.json`, with `keep` and `exclude` arrays of absolute or
`~/` paths. Use `--config <file>` for another settings file. CLI exclusions are
temporary. These preferences apply to the filesystem viewer/scanner; the
original known-target report is unchanged.

Use the drive dropdown to scan another mounted volume or **Open report…** to view
a CLI `whyfull-report` JSON report or a `whyfull-disk` snapshot. The viewer streams
imports to private temporary storage and removes it after parsing. CLI reports
show known targets, discovered caches and worktrees separately because their
measurements may overlap. Errors and action feedback appear as toasts.

The JS scanner measures every accessible regular file once and retains every
directory plus its largest 32 direct files. Smaller direct files are grouped;
**All direct files** reads the current folder's complete file listing on demand.
Snapshots retain all directory summaries and the largest files, not every
filename. Allocated and logical sizes are separate, hard-linked bytes are counted
once, and APFS clones may still share blocks. Measured sizes are not guaranteed
reclaimable space.

Filesystem snapshots use a separate `whyfull-disk` JSON format, version 1.
Export and import stream JSON to avoid one huge string in memory; viewing still
retains the directory inventory. Export after completion or pausing. Reports
contain private local paths, use owner-only permissions, and refuse overwrites.

See [viewer and scanner development](docs/viewer.md) for the architecture,
configuration experiments and verification notes.

## Desktop app and standalone CLI

Find installers, standalone CLI archives, and setup instructions on the
[download page](https://whyfull.app/download/). Desktop downloads appear after
their release is published; npm remains available separately.

Whyfull also builds as a **Tauri desktop app**, bundling the same viewer and
Node engine so users need no Node installation. Use **Whyfull → Install
command-line tool…** to expose the same `whyfull` report command in your terminal.
Signed release builds check for updates; the desktop-installed command follows
app updates. npm installations continue to update through npm.

Build locally with `pnpm desktop:build`, or `pnpm cli:archive` for a portable CLI
with its runtime. See the [desktop build and release guide](https://github.com/iplanwebsites/whyfull/blob/main/apps/desktop/README.md)
for prerequisites, signing setup, release artifacts, and update behavior.

## Demo-first cleanup

The report and scanner read metadata. Viewer cleanup starts in **demo mode** every
session: previews and “Run demo” never change scanned files. To enable real moves,
start a live viewer with `whyfull --view --allow-trash`, then enable Trash in the
UI and confirm an individual preview. Saved snapshots support demo cleanup only.

Real cleanup uses the native macOS 14+ Trash command, with no permanent-delete
fallback. Keep rules protect folders and their containing folders. Scan roots,
core system locations, symlinks, and items changed since preview are rejected.
Pause or finish scanning before enabling real moves. Restore items in Finder;
rescan afterward to refresh sizes. The appropriate tool-specific cleanup command
is still preferable for shared model/package stores.

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

### Brochure website

`apps/brochure` is the standalone public website for `whyfull.app`.
`apps/web` remains the bundled local disk viewer. To work on the brochure:

```bash
pnpm --filter @whyfull/brochure dev
pnpm --filter @whyfull/brochure build
```

The brochure runs at `http://127.0.0.1:3001` and builds to
`apps/brochure/dist`. Deploy the Worker and generated static assets with
`pnpm --filter @whyfull/brochure run deploy` through Cloudflare Wrangler. See
[`apps/brochure/README.md`](https://github.com/iplanwebsites/whyfull/blob/main/apps/brochure/README.md)
for template provenance and hosting setup.

## Native experiment

[`packages/whyfull-native`](https://github.com/iplanwebsites/whyfull/tree/main/packages/whyfull-native)
tracks an experimental standalone build using
[scriptc](https://scriptc.dev/). It is not part of the npm release. The normal
Node CLI remains the supported package.

## License

[Apache-2.0](https://github.com/iplanwebsites/whyfull/blob/main/LICENSE) © Felix
Menard.
