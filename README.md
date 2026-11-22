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

The command line is free. The desktop app is free for 30 days, then $19 once
([pricing](#pricing)). Scans run locally. No automatic deletion.

## Find out where it went

Choose how to explore your disk:

```bash
npx whyfull
```

Four commands cover most uses:

| Command              | What it does                            |
| -------------------- | --------------------------------------- |
| `npx whyfull`        | Interactive picker. Start here.         |
| `npx whyfull --tui`  | Terminal summary with cleanup guidance. |
| `npx whyfull --json` | Report for your coding agent.           |
| `npx whyfull --ui`   | Visual explorer in your browser.        |

With the desktop app's CLI, a standalone archive, or a global npm install,
`whyfull` is already on your PATH, so drop the `npx`.

In a terminal, the bare command opens an interactive picker: launch the web UI with an
automatic Home scan, open the UI without scanning, print an opportunity summary,
save a JSON opportunity report or full filesystem inventory, or read help.
Use ↑/↓ to highlight an action and Enter to run it. The command appears beside
the highlighted action and remains visible after selection, so you can repeat it
in a script. Selecting an action runs it immediately; a loading indicator stays
active while the command prepares the UI or report. Esc or Ctrl+C cancels. Without a terminal, the bare command prints
help and exits without scanning or prompting.

For the opportunity summary directly, run `npx whyfull --tui`. You’ll get sizes,
safety tiers, and tool-specific cleanup guidance for known
locations, discovered caches, and Git worktrees. Start with the biggest useful
opportunities instead of guessing which mysterious folder can go.

Requires [Node.js](https://nodejs.org/) 22.18 or newer. No global install needed.

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
npx whyfull --ui
```

Explore folders as nested rings in the **sunburst**, or compare their sizes at a
glance in the **treemap**. Click into the biggest pieces, search the file list,
and mark folders to keep or exclude. The desktop app includes the same viewer.

The report starts with known tool locations; the viewer lets you explore a whole
drive or a folder of your choice. `--ui` opens the latest completed full scan
and refreshes sizes in the background; without one, it starts scanning Home.
Use `npx whyfull --ui --no-scan` to open the UI and choose a scan or saved report
there. `--view`, `ui`, and `app` are aliases for `--ui`.

## Keep an eye on one project

Use directory mode for a project or another folder you revisit:

```bash
npx whyfull --directory                       # Open the UI here and scan this folder
npx whyfull --directory ./project --ui         # Choose another folder
npx whyfull --directory --scan --json-file ./folder.json
npx whyfull --directory ./project --json       # Machine-readable folder inventory
npx whyfull --directory --tui                  # Terminal filesystem summary
npx whyfull --directory --ui --no-scan         # Open cached results without refreshing
npx whyfull --directory --no-cache             # Scan fresh; do not read or write a cache
```

`--dir` is a shortcut for `--directory`. Both take an optional path; omitting it uses the current working
directory. It opens the browser UI by default. Add `--scan`, `--json`,
`--json-file`, or `--tui` for a headless folder scan. The JSON is a `whyfull-disk`
inventory; without `--directory`, `--json` still produces the known-tool
opportunity report. Workers, engine, exclusions, custom config, JSON exports,
and the viewer's existing options also work in directory mode. Use either
`--directory` or `--root` to choose the root.

Completed folder inventories are cached privately in `<folder>/.whyfull/inventories/`.
The UI opens with that file’s saved (possibly stale) inventory and refreshes it
in the background; `--no-scan` waits for an explicit scan. Headless directory scans always measure
the folder again and replace its cache. `.whyfull` contents are excluded from
filesystem scans so reports never count their own cache. Add `.whyfull/` to a
project's `.gitignore`.

`--no-cache` disables persistent cache reads and writes for the whole session,
including Home and disk scans opened from the UI. Existing cache files stay
untouched, and `--json-file` still writes an explicitly requested export.

The folder is the initial view and stays available in the location menu. Home
and disks are scanned only when you select them; you can return to the folder's
own inventory afterward. Home and disk caches continue to use the normal
configuration directory, including when launched from a folder session.
The starter also offers **Open current directory** and **Save current directory
scan as JSON**, with command previews and loading indicators.

## Bring your coding agent

### Make Whyfull yours

Open **Settings → Saved places** in the app to save frequent folders, and
**Settings → Instructions** to write preferences for
your user profile or this computer. Saved places appear in the scan menu and
opportunity reports. Project locations also help discover caches and worktrees.
Use **Scan a folder…** for a one-time scan.

```bash
whyfull scan ~/Projects                 # Folder inventory; no path means cwd
whyfull locations add ~/Projects --id projects --kind project --source agent
whyfull instructions set --scope computer --text 'Keep models needed offline.'
whyfull locations list --json
```

Instructions are private guidance, and Keep / exclude rules still control file
protection. Agents can update locations by stable ID, with revision checks for
concurrent edits. **Prepare public contribution…** in a place’s advanced editor prepares a public JSON draft using explicit
portable paths and public guidance, without copying your private notes.
[Personalization, agent workflow, and PR guide](docs/personalization.md).

### Share a report with your agent

Give your agent a measured opportunity report to investigate. Explicit commands
never open the picker. `--help` lists commands and output formats for runners:

```bash
npx whyfull --help
npx whyfull --tui --json-file ./opportunities.json
npx whyfull --scan --root /path/to/disk --json-file ./disk.json
```

For machine-readable opportunity output on stdout:

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

| Command                                              | What it does                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `whyfull`                                            | Interactive picker. Start here. (Help when not in a terminal.)  |
| `whyfull --tui`                                      | Terminal summary with cleanup guidance.                         |
| `whyfull --ui`                                       | Visual explorer in your browser; reopens the latest scan.       |
| `whyfull --directory`                                | Open the UI scoped to cwd; cache in `.whyfull/inventories/`.    |
| `whyfull --directory ./project --json`               | Emit a filesystem inventory of one folder.                      |
| `whyfull --directory --scan --json-file folder.json` | Scan cwd and save its inventory.                                |
| `whyfull --ui --no-scan`                             | Open the web UI without starting a scan.                        |
| `whyfull --help`                                     | Commands and options for people, scripts, and agents.           |
| `whyfull --json`                                     | Report for your coding agent: JSON only, no presentation text.  |
| `whyfull --json-file report.json`                    | Save the JSON report without replacing an existing file.        |
| `whyfull --top 10`                                   | Show the ten largest children of each large target.             |
| `whyfull --no-drill`                                 | Skip child breakdowns for a quicker scan.                       |
| `whyfull --exact`                                    | Fully count huge package stores instead of using a file budget. |
| `whyfull --discover`                                 | Also look for unknown 5 GB+ directories in common user folders. |
| `whyfull --no-cache`                                 | Skip loading and saving persistent scan caches.                 |
| `whyfull --no-cache-scan`                            | Skip the default scan for unknown 250 MB+ user/project caches.  |
| `whyfull --no-worktrees`                             | Skip the default git worktree scan.                             |
| `whyfull --worktree-age 7`                           | Only show worktrees idle for at least seven days.               |
| `whyfull --all`                                      | Include known locations that were not found.                    |

The command exits with `0` after a report or help output, and `2` for an invalid
option or value. Permission-denied locations are marked as undercounts in the
report rather than treated as a failed run.

## Viewer and scanner details

Switch between a **sunburst** (concentric folder rings) and **treemap**, with
breadcrumbs and a searchable list of the largest pieces on the right. While a
scan runs, a branded loading screen shows system-reported drive fullness and
free capacity immediately, separately from the scan progress bar. Elapsed time
and file count stay visible, with a coarse time estimate when available.
**Scan details** reveals space found, speed, remaining folders, and the current
path. The drive menu shows capacity and live progress for background scans;
choose **Scan** on another drive to start its scan and keep both inventories.
Completed full scans from the CLI, web UI, and desktop app share
`~/.config/whyfull/scans/` (next to an alternate `--config` file when supplied).
Agents can read the latest root and inventory path from `scans/latest.json`.
Opening the latest root from the app or plain `--ui` displays its saved report
while refreshing in the background. A notice labels the saved sizes with their
scan time; folders remain browsable throughout the refresh. Use `--no-scan`
to browse saved results without refreshing. Explicitly reopening another cached root refreshes in the
background; the map swaps to the new report only after completion. **Rescan**
also keeps the last complete map visible. Stopping
a refresh retains the previous report. The map,
folder sizes, and cleanup actions appear after the scan finishes, so partial
totals never change the chart while you explore. Stopped or failed scans offer
a retry instead of incomplete results. All viewer assets are bundled and work
offline; the authenticated server binds only to `127.0.0.1` on a random port.

```bash
whyfull --ui --root ~/Library --workers 4
whyfull --ui --exclude ~/Pictures --exclude ~/Music
whyfull --scan --root ~/Downloads --json-file disk.json
whyfull --ui --snapshot disk.json
whyfull --ui --report caches.json
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
unknown. Manage saved rules in **Keep & exclude rules**. Rescan to apply
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

## Pricing

- **Command line: free.** `npx whyfull`, the npm package, standalone CLI
  archives, and the CLI bundled in the desktop app (including `--ui`) are free
  for personal and commercial use. No key, no account.
- **Desktop app: 30-day free trial, then $19 one-time.** The trial counts days
  you open the app, not calendar days. One license is per person and covers
  every computer you use. Updates are included, and refunds are available for
  30 days, no questions asked.
  [Buy a license](https://whyfull.app/buy/) ·
  [Lost your key?](https://whyfull.app/recover/)

The app never locks features. After the trial it shows a gentle reminder at
most once a day after a scan; the [terms](https://whyfull.app/legal/) still ask
for a license to keep using the desktop app. Keys are verified offline, and
neither the app nor the CLI sends anything anywhere: no telemetry, no license
check-ins.

Buying for a company? Get one license per person who uses the desktop app. The
CLI stays free for everyone.

## Demo-first cleanup

The report and scanner read metadata. Viewer cleanup starts in **demo mode** every
session: previews and “Run demo” never change scanned files. To enable real moves,
start a live viewer with `whyfull --ui --allow-trash`, then enable Trash in the
UI and confirm an individual preview. Saved snapshots support demo cleanup only.

Real cleanup uses the native macOS 14+ Trash command, with no permanent-delete
fallback. Keep rules protect folders and their containing folders. Scan roots,
core system locations, symlinks, and items changed since preview are rejected.
Finish scanning before enabling real moves. Restore items in Finder;
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

Project-cache discovery includes `.cache` children plus whole `.turbo` and
`.scriptc-cache-v1` directories, including ScriptC's nested Zig cache. It checks
common source roots, the current directory and Codex worktree roots without
entering dependency or build trees. Sizes identify review candidates; they do
not establish that a cache is dead. Large `.turbo/cache` folders also appear as
rebuildable build caches in full disk inventory suggestions; inspect recent use
before moving the cache folder to Trash. For Maru compile entries, use the owning
`tooling/scriptc-cache-gc.mjs` collector to retain live source identities. Removing
an obsolete worktree can make more shared compile entries stale, so inspect
again afterward. Detached worktrees require commit preservation before pruning;
Whyfull withholds a combined cleanup command for them.

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
change over time, so a verified fix is valuable. Contributions are accepted
under the [contributor agreement](https://github.com/iplanwebsites/whyfull/blob/main/CONTRIBUTING.md).

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
Node 22.18 or newer.

### npm releases

After updating `packages/whyfull/package.json`, run `pnpm check` and
`pnpm npm:check`. The latter builds and packs the CLI and UI, installs the tarball
outside the workspace, and runs `npx whyfull --view` against a small
fixture. It verifies the local API, every bundled UI asset, and the filesystem
worker. On macOS and Linux it also verifies the browser-opener call using a test
stub; on other platforms it passes `--no-open`.

Publish the verified tarball with
`npm publish .artifacts/npm/whyfull-<version>.tgz --access public`. The package's
prepack hook checks the publish docs and builds the viewer before packing.

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

Whyfull is **source available**, not open source. © Felix Menard. All rights
reserved.

The source is public so you can see exactly what Whyfull does with your disk:
read it, review it for security and privacy, reference it in bug reports, and
contribute under the contributor agreement. The [source license](https://github.com/iplanwebsites/whyfull/blob/main/LICENSE)
grants no right to copy, modify, redistribute, or reuse the code, the location
catalog, or the docs in other products. Using Whyfull is covered by the
[end-user license agreement](https://whyfull.app/legal/): the CLI is free, and
the desktop app needs a license after its trial. The EULA, source license, and
privacy note are all on [whyfull.app/legal](https://whyfull.app/legal/).

Releases published before this change (npm `whyfull` 0.0.1–0.0.2, desktop
0.0.1, and the git history before the relicensing commit) remain available
under Apache-2.0, as they were published. Third-party components keep their own
licenses. "Whyfull" and its logo are trademarks of Felix Menard.
