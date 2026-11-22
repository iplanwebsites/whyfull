# Local filesystem viewer

The browser UI and default Node scanner are JavaScript, built from the repository's TypeScript
library and a React frontend. The default Node path needs no Rust toolchain,
native addon, hosted service, CDN, or Electron installation.

## Experimental Rust scanner

The location menu includes **Use Rust scanner · Experimental**. It is off by
default. The selection is saved and applies to new scans and explicit rescans;
changing it leaves the current result and running scans alone. The menu and scan
details show the active scanner separately from the choice for the next scan.
Switch it off to return to Node. The default worker budget is four for Rust and
up to eight for Node; `--workers` can override it.

Both crawlers stream into the same SQLite inventory. Node workers send bounded
batches; their pending folder queue and hard-link ledger also live in SQLite.
Rust uses its bounded traversal queue and streams records to the same writer.
Both paths share batched transactions, folder aggregation, indexes, bounded
viewer queries, marks, suggestions, Finder, cleanup, and streamed JSON export.
Folder totals are prepared on disk before the map opens, shown as **Preparing
results**. Suggestions use known locations and a bounded selection of large
folders; the full inventory remains browsable. Advanced live “All direct files”
listings and imported JSON reports retain the existing listing/import behavior.

Both scanners require Node 22.18+ for built-in SQLite. Rust additionally requires
a matching executable on macOS or Linux. Supported desktop builds bundle both
Node and the helper; builds without the helper keep Node available and disable
the Rust toggle with an explanation. A failed scan is shown as a failure rather
than silently switching engines. A failed or cancelled refresh keeps the last
good result. Cancelled scans must be restarted before browsing or export.

```sh
npx whyfull --scan --root /path/to/folder --scanner rust --json-file scan.json
npx whyfull --ui --scanner node
```

For development, build `experiments/disk-crawler/Cargo.toml` in release mode, then
rebuild whyfull. `WHYFULL_RUST_CRAWLER` can select a trusted executable explicitly.
The npm build can include a prebuilt helper for its build platform; other
platforms keep the Node default unless a matching helper is supplied. Installing
the normal Node CLI still needs no compiler.

Both engines use the same database format with separate cache slots, so a
comparison or engine switch preserves the other engine's completed inventory.
Databases live under a pruned `.whyfull/inventories` directory inside the selected
cache directory. Private session links keep old results stable while a refresh
publishes a new cache atomically; session links are released when the viewer
closes. `--no-cache` skips persistent cache reads/publication while both crawlers
still use a temporary SQLite working inventory. Older JSON snapshots can still
be opened explicitly; old in-memory/experimental cache formats are rebuilt by
the next scan.

Programmatic callers can use `scanFilesystem({ root, scanner: "node" })` or
`scanner: "rust"`; release either result with `releaseDiskSnapshot(snapshot)`
when finished. `inventoryDirectory` overrides private working storage. The
`directories` array is a lazy compatibility facade: targeted lookup is cheap,
but iterating or spreading it can traverse the entire database. Use
`saveDiskSnapshot` for streaming JSON export. `loadDiskSnapshot` accepts completed
SQLite inventories as well as portable JSON. Loaded SQLite results also need
release; importing a large JSON snapshot uses the in-memory reader.

`DiskSnapshot.timings` separates crawling/ingestion, aggregation, indexing and
final commit/checkpoint time. The reproducible drive comparison lives in
`experiments/disk-crawler/shared-benchmark.mjs`; it also includes atomic cache
publication in its end-to-end measurement and records first-page latency and
process-tree memory. Raw crawler benchmarks omit viewer preparation and should
not be used as end-to-end app timings.

The shared-storage Data-drive comparison covered about 28.58 million files and
3.79 million directories. With four workers per crawler and two sequential runs
each (R4 N4 N4 R4), Node averaged 7m 43s and 337 MiB peak sampled process-tree RSS;
Rust averaged 4m 26s and 143 MiB. End-to-end times include aggregation, indexing,
final checkpoint and cache publication. Both used a 512 MiB main heap setting.
These are live-volume measurements with existing swap and background activity;
the report includes per-run ranges, coverage checks and caveats. See the
repository's `experiments/disk-crawler/results/shared-storage-full-drive.md`.

## Launch

```sh
npx whyfull --ui
npx whyfull --ui --no-scan
npx whyfull --directory
npx whyfull --directory ./project --ui
npx whyfull --directory --scan --json-file folder.json
npx whyfull --ui --root ~/Downloads
npx whyfull --ui --report report.json
npx whyfull --ui report.json
```

`npx whyfull --ui` opens the visual explorer in your browser; `--view`, `ui`, and
`app` are aliases. It starts the bundled local server,
open the user's default browser, and scan the home directory unless another root
or a saved report is selected. Use `--no-open` to print the private viewer URL
without launching a browser. Use `--no-scan` with `--ui` to open the viewer without
starting a scan or refreshing cached results; choose **Start scan**, a drive, or a
saved JSON report in the UI. The bare `npx whyfull` opens the interactive picker
in a terminal. Use ↑/↓ and Enter; the highlighted action shows its equivalent
command. Enter runs the command with a loading indicator until the UI or results
are ready. The default action opens the browser automatically and scans Home.
Choices include `--tui` for the opportunity summary and JSON saves. In
scripts it prints help; use explicit flags to run without prompts. Keep the terminal running; Ctrl+C stops the viewer.
All existing viewer options, including `--config` and `--allow-trash`, work with
every alias. Demo mode remains the default.

## Directory mode

`--directory [path]` (short form `--dir`) scopes the scan to a folder. A bare flag means the current
working directory. It opens the UI by default, or combines with `--scan`,
`--tui`, `--json`, and `--json-file` for headless inventories. JSON exports use
the same `whyfull-disk` format as full disk scans. `--workers`, `--engine`,
`--exclude`, `--config`, `--no-open`, `--no-scan`, and `--allow-trash` keep their
usual meanings. `--root` and `--directory` are alternative scope selectors.

The selected folder stays pinned above Home in the location menu. Launching this
mode scans only that folder. Choosing Home or a disk starts the broader scan;
returning to the folder restores its separate inventory, even when the broader
scan also covers it.

Completed directory inventories and their refresh baselines live in
`<folder>/.whyfull/inventories/`, with a SQLite cache slot for each scanner.
Subfolder scans write their own `.whyfull/inventories/` without replacing the
parent’s cached inventory. Home and disks outside the selected folder use the
regular cache next to the configuration file. Reopening a folder restores its inventory
and refreshes in the background, unless `--no-scan` is used. Explicit headless
scans are fresh measurements and also update the local cache. Failed or cancelled
scans never replace a good cache. All `.whyfull` directory contents are excluded
from filesystem inventories to prevent cache growth from counting itself.
Cache files remain private (owner-only permissions). Add `.whyfull/` to the
project's `.gitignore`.

`--no-cache` bypasses both reading and writing persistent scan caches for folder,
Home, and disk scans. It leaves existing cache files unchanged. It also works
with `--no-scan` (open an idle viewer) and `--json-file` (save an explicit export).
Programmatic viewers can set `cache: false` for the same behavior.

The interactive starter includes opening and exporting the current directory;
highlighting either action shows its repeatable CLI command.

## Design

Live scans show a branded loading screen with a hard-drive capacity card using
system-reported fullness and free space from the first response. A separate scan
progress bar tracks estimated traversal work. File count and elapsed time stay
visible; other metrics are collapsed under **Scan details**. Drive-menu entries
show “Scanning… ~83% complete”. Reruns compare checked folders with the previous
full inventory (expanding the baseline if more folders are discovered). A first
scan retains its last available estimate between live estimates; its tooltip
identifies that case. Completion stays below 100% until the scan finishes.
The UI waits for a completed scan before requesting directory summaries or
showing the map, folder byte totals, ranked list, and cleanup actions on the first
scan. Completed scans are automatically saved and reopened on the next launch or
first selection of that root. A saved report stays visible while a fresh scan runs
in the background. **Rescan** uses the same behavior. Once a map is available,
the toolbar keeps navigation and size information. Scan timing and refresh
controls move into the drive dropdown. Running rows retain their completion
percentage and timing details; hovering or keyboard-focusing a row reveals
**Stop**, and touch devices keep it visible. Stop targets that row's scan even
when another drive is currently open, without changing the selected folder.
The full loading page retains detailed progress and its stop control. Each completed snapshot retains its
full scan duration. Reruns show that baseline alongside elapsed time and an
approximate remaining duration (for example, “Last scan took 5 min · Running for
3 min · About 2 min remaining”). If the scan exceeds the previous duration, the
message changes to “Taking longer than last time”; delayed server updates hide
the remaining estimate. The baseline is specific to the reopened root and scan
settings, and incomplete scans never replace it. Only a completed refresh replaces the
map; stopping or failing a refresh preserves the last complete report. A first
scan that stops or fails shows an incomplete-results message and a retry action. Incomplete saved snapshots offer a fresh scan of
their root folder. Complete saved snapshots and CLI reports open directly.

The two views follow familiar disk-navigation conventions:
[Filelight's](https://apps.kde.org/filelight/) concentric folder rings and
[GrandPerspective's](https://grandperspectiv.sourceforge.net/) proportional rectangles. Both
share the same current directory, breadcrumbs, ranked list, and details panel.
See [comparable products and UX opportunities](comparable-products.md) for a
working product comparison, including Wombit.
Sunburst rings show up to three levels; treemaps use horizontal-biased weighted
partitions showing one directory level at a time, without inset child cards. Clicking
a directory navigates; the center/up button ascends. The list provides keyboard
navigation, search, paging, and access to folders too small for chart labels.
Folder navigation retains the previous chart, breadcrumbs and rows until the next
result is ready. Retention is scoped to one inventory so a drive/report switch never
reuses stale IDs. Rings load before switching modes, and both charts measure/draw
before paint to avoid loading-message flashes and initial layout jumps.

The UI uses the shadcn `b0` monorepo preset (Base UI, neutral Nova style,
Tailwind 4 and Lucide icons), with shared components in `packages/ui` and the
TanStack Start app in `apps/web`. TanStack Router owns folder, search, map and
sort URL state and supports browser back/forward. React Query fetches bounded
folder summaries. Press Command/Ctrl+K to focus folder search. Last folder, map,
sort and appearance preferences survive CLI restarts in the config file.
The compact workspace keeps drive selection and breadcrumbs in the toolbar,
without a product-name banner. Errors and action feedback use Sonner toasts.
A disconnected backend shows one persistent banner above the workspace while the
last available view stays visible. Offline polling and failed actions do not
create error toasts. Polling continues to check the connection; recovery removes
the banner and refreshes active queries. **Check connection** retries immediately.
If the backend restarted on a different port, open its newly printed URL.
Other repeated query errors notify once until that query succeeds again.
The drive selector includes Home and mounted volumes. A destination is scanned on
its first selection; returning to it reuses its existing inventory. Running scans
continue in the background when switching destinations or opening a report. Home
and other folders already covered by the current disk inventory open directly.
Completed inactive scans use private temporary files rather than retaining every
inventory in memory. Complete live scans also persist across viewer restarts in
`~/.config/whyfull/scans/`, or a `scans/` directory beside an alternate `--config`
file. Headless full scans use this same cache, and `latest.json` records the last
completed root and snapshot path so the CLI UI, desktop app, and agents can
reopen it immediately and refresh sizes in the background. The explorer labels
saved sizes with the scan time and keeps navigation available during refresh.
`--no-scan` opens saved results without refreshing. One cache slot per root and scanner is replaced atomically using private directory/file
permissions. Cache loading checks the root's device and inode, exclusion/keep
rules, retained-file setting, and format version. Incompatible or corrupt caches
fall back to a fresh scan. Imported reports and incomplete scans are not cached.
Use **Rescan** to refresh changed sizes within the current session. Cached reports
and background refreshes support demo cleanup only until a fresh scan completes.
A refresh preserves browser history and the selected folder path; a revision
invalidates folder queries and selections when the new inventory is ready.
Background refresh keeps the completed database available while a separate
working database is scanned. Both readers use bounded caches; refreshing no
longer retains two full JavaScript trees or needs a 12 GiB inventory heap.
Completed SQLite caches open by reading metadata rather than parsing the whole
inventory. Browser Back/Forward restores the
corresponding live inventory and folder without starting a scan. Switching
inventories always returns cleanup to demo mode.
Folder views stay cached in browser memory for the session; moving between Home
and Data reuses the shared disk inventory and previously opened views. All
destinations show the same two-line summary as the loading screen: name and total
capacity, then percent full and free space, red at 90% used. The compact menu
omits paths and progress bars; running destinations show a spinner and estimated
scan percentage, refreshed every 1.5 seconds. Paths remain available on hover.
**Scan** starts an unscanned destination; selecting an existing destination returns
to its inventory. Scans can run concurrently. Home
shows the usage of its containing disk, rather than a percentage of folder size.
File-heavy folders keep the selected chart visible. When no individual file uses 1% of the direct-file space, the chart combines the files into one group; significant outliers stay separate. The sidebar summarizes the measured file count, space used, average, and largest size on disk. **File size breakdown…** opens an optional measurement dialog without replacing the chart.

Drag the divider between the chart and file list to resize them, or focus it and use the arrow keys. The default split is 70/30, with minimum widths of 320 px for the chart and 280 px for the list. Narrow screens stack the panes vertically. Layouts are remembered separately for each orientation in this browser.

It also opens saved JSON reports without restarting the runner. View modes, Finder,
appearance and scan actions in an ellipsis menu. Right-click a breadcrumb, list
entry, treemap tile or ring to open its Base UI context menu. Directory marks
(`trash` or `useless`; legacy `delete` marks are migrated) are saved in the configuration separately from keep/exclude
rules. The toolbar's **Trash shortlist** button shows the number of Trash marks and opens all saved marks across scans. The list is also available under **Cleanup shortlist** in the ellipsis menu.
Trash-marked entries remain visible, appear before unmarked entries, and use red, struck-through names in directory lists, reports, and the shortlist.
The shortlist includes folders outside the current inventory with unknown sizes. Browse measured
folders, reveal them in Finder, or clear marks individually. Marks are review metadata;
they never move files. Native cleanup always moves to Trash and starts in demo mode.
Finder accepts only inventory directory IDs, report locations or saved shortlist paths,
rechecks the live directory, resolves macOS path aliases, and runs `/usr/bin/open -R`
without a shell. Missing folders, permission failures and launch errors show red toasts.
Start the Node.js runner with `node packages/whyfull/dist/cli.mjs --ui --report file.json`
(or `pnpm viewer --report file.json`) and keep its terminal running while using the UI.
Folder counts,
scan metadata and explanations live in the details/rules dialogs; selection
actions appear only when inspecting an entry. Chart colors assign distinct hues
through OKLCH coordinates anchored to size-ranked inventory ancestry. Drilling
into a folder preserves its color exactly. The largest child stays nearest its
parent; successive levels alternate hue-led and lightness/chroma-led forks, with
smaller but bounded variation deeper down. Lightness bounces at its bounds to avoid
flattening siblings into identical tints. Colors may overlap across branches;
there is no unique-color-per-directory promise. Constant-lightness/hue chroma
reduction maps colors into sRGB consistently for SVG, canvas and list dots.
The treemap, rings and list share the same colors, with tinted edges and
theme-specific fills; label foregrounds retain at least 4.5:1 contrast.

Cleanup defaults to demo on every server start; the mode is never persisted.
`--allow-trash` enables the capability for a live scan, but users must still turn
off demo mode and confirm a short-lived, one-use preview. Only macOS 14+ native
Trash is supported for actual moves. No permanent removal endpoint exists.
Saved snapshots support demo only. Keep and exclude rules also block moves of
ancestors that contain protected paths. Root/system locations and changed or
symlinked paths are rejected. The inventory is refreshed by an explicit rescan.

For large direct-file lists, the sidebar shows the true file count and labels the
32-filename limit instead of calling it the folder total. When the largest measured
file uses less than 1% of direct-file space and the scan has no issues, it explains
that no single file dominates. **List all files** reads live filenames with paging;
**Scan folder & list all files** starts a fresh, scoped live scan from a saved
inventory without rescanning the whole drive. Search explicitly names its limited
scope while only the largest filenames are available.

File-heavy folders default to a **File sizes** panel instead of an almost-solid
remainder ring. It shows average and largest sizes, then buckets with separate
file-count and allocated-space bars so sidecars and rare outliers remain visible.
**Measure file sizes** explicitly reads every direct file’s metadata, with eight
concurrent stat calls and no content reads. Size ranges use logical file sizes;
space bars use allocated bytes per filename (shared blocks can overlap). Results
are labelled live, timestamped and cached in the browser per inventory/folder;
refresh is explicit. Saved reports are never used to estimate missing buckets or
silently replaced. **Show map** restores the treemap/radial view.

File groups use compact counts such as **14k files**, with allocated size beneath.
Large treemap blocks scale up the count for readability. Charts have no native
hover tooltips; the footer shows the hovered path and size, and right-click →
**Inspect** or the list's inspect button opens details. Accessible labels retain
exact counts; file-only groups preserve counts across chart limits.

Sizes use whole MiB and at most one decimal for GiB/TiB. When the current folder
or report section reaches a TiB, GiB values use whole numbers too. Zooming into a
smaller folder restores useful precision; charts and the ranked list share a scale.

**Analysis** in the toolbar (also in the ellipsis menu) runs individual read-only commands: disk usage,
macOS volume information, local snapshot listing, system storage information, and
inventory suggestions. System commands have a play button, live stdout/stderr,
exit status, stop control, and copyable observation context. They run on the local Node.js
runner by fixed ID without a shell or arbitrary command input. Inventory suggestions
reuse the completed disk size tree in memory and never launch a CLI scan. Traces stay in memory
for the runner session, are bounded, and survive switching commands or closing the
panel. Failed commands show a red toast; long-running commands have timeouts.

## Storage report and suggested actions

**Suggestions** in the top-right ellipsis menu opens the storage report in a
modal above the disk explorer in both the desktop app and browser viewer. Close
it or press Escape to return to the same disk view. Imported CLI reports open
with this modal above their measured-location table. Suggestions are generated
automatically after the disk scan completes, using the measured JSON inventory.
They also work with completed saved inventories. **Refresh suggestions** reuses
those recorded sizes; use **Rescan** in the disk viewer to measure filesystem changes.

Findings appear in a compact table grouped by cleanup tier, with location,
size, and suggested action in each row. Click **Size** or choose **Largest first**
or **Smallest first** to rank all recommendations across tiers. Unknown sizes stay
last. Choose **Cleanup tier** to return to grouped findings. Expand a location for its path, commands,
and measured subfolders; the row's ellipsis menu offers folder actions and copying.
Search by name, path, category, or suggested action. Measurement notes and inventory
scope are available under **Report details** in the footer. Known-location rules
match only paths recorded in the inventory, including macOS Data-volume aliases.
Excluded or unreadable descendants retain partial-size caveats. Unmatched caches,
large folders, and possible worktree folders receive review advice. Git state,
activity, pnpm sharing, and simulator metadata require separate validation; they
are not inferred from directory sizes.
Each folder and measured subfolder offers **Explore on disk**, **Finder** on
macOS, and **Path** to copy its location. Exploration reuses a covering disk
inventory where available, and preserves the report for returning to the findings.

**Copy report**, **Copy filtered**, and **Copy finding** include measured
facts, suggested actions, command references, and a request to validate the actions
before cleanup. Inventory-based reports include their source root, completion
time, and limitations. **Copy command** copies an individual command without running it.
Imported recommendation text remains reference material. Sizes may overlap and
are not guaranteed reclaimable space; partial measurements remain lower bounds.

The same postprocessing is available programmatically without rescanning:

```js
import { loadDiskSnapshot, analyzeSnapshot, forPlatform } from "whyfull"

const inventory = await loadDiskSnapshot("disk.json")
const report = analyzeSnapshot(inventory, forPlatform())
```

## Scan progress

The drive-capacity card uses the containing filesystem's system statistics,
independent of the growing inventory. It shows percent full, used/total capacity,
and free space immediately, even while discovering folders. Unavailable capacity
is labeled explicitly. Home and folder scans show their containing disk's usage.

The separate scan bar uses the backend's estimated traversal percentage, with an
approximation marker. It stays indeterminate until enough stable work samples
exist. Elapsed time and file count appear in one compact line; a coarse remaining
time range appears when available. **Scan details** contains space found, the
known folder queue, scan speed, and current path.
After at least six seconds of observations, the backend estimates remaining work only when both
halves of a recent ten-second window show a consistently shrinking folder queue.
It accounts for new child folders found per completed folder, and turns the recent
net queue-drain rate into a coarse remaining-time range. A new discovery burst,
insufficient samples, unstable throughput,
or a slow directory withdraws the estimate and returns the scan bar to its
indeterminate state. Drive fullness remains independent of scan progress.

Workers send activity updates while processing large directories, not just after
returning their final totals. These updates feed loading metrics without being
added twice to the inventory. After six seconds without new results, the UI shows
the current path and a filesystem-wait message. A scan can legitimately wait on
slow storage; the bar does not advance on a timer or promise a deadline.
The browser also withdraws a cached scan percentage and scan speed after six seconds
without a fresh server response, replacing them with a waiting-for-updates state.
Fresh responses automatically restore the current scan state.

Found bytes divided by used disk space do not imply time completion. Folder scans
do not cover the whole volume, excluded folders and
shared blocks affect byte totals, and a large archive can take one metadata read
while a tiny-file cache takes millions.

Comparable implementations separate unknown-total discovery from measurable
work: [Czkawka marks collecting files/folders as indeterminate](https://github.com/qarmin/czkawka/blob/master/czkawka_core/src/common/progress_data.rs),
and [WinDirStat's progress control uses a marquee when its total is unknown](https://github.com/windirstat/windirstat/blob/master/windirstat/Dialogs/ProgressDlg.cpp).

## Scanner

`DiskScanner` schedules each directory once across a bounded pool of worker
threads. Each worker reads one directory's entries, checks metadata without
following symbolic links, returns child directories and direct-file aggregates,
and retains the largest direct files. Aggregation visits directory nodes in
reverse parent order. The main event loop serves the UI while workers perform
metadata reads. A failed read does not abort the rest of the inventory.

The sync engine performs synchronous metadata calls inside each worker; the
async engine fans out up to eight metadata calls per worker. Workers default to
CPU parallelism minus one, capped at eight, with a configurable range of 1–32.
Exclusions prune traversal before descending. Kept paths remain measured.

The viewer starts in the user’s home directory. The drive selector includes a Home
shortcut, macOS Data, and other mounted drives. An explicit `--root` overrides Home;
the standalone `--scan` default remains the system data volume.

The macOS Data root `/System/Volumes/Data` includes the writable data volume
without also traversing the system firmlink aliases. Different devices are
excluded and can be scanned separately. Rules understand `/var`/`/private/var`
aliases and Data-volume user-path aliases. Rules use path boundaries rather
than raw string prefixes. Glob patterns and automatic `.gitignore` exclusion
are deliberately absent: ignored development output is often the point of a
disk diagnostic.

Allocated bytes come from `stat.blocks * 512`; logical bytes come from
`stat.size`. Hard-linked inodes are attributed once to their first encountered
directory, so their placement can differ with scheduling. Filename counts
include each encountered regular-file name. APFS clones with distinct inodes
can share blocks; deleting one may free less than the displayed size. Directory
metadata, snapshots, skipped files and unreadable data are outside file-byte
totals. Scan completion means traversal finished, not complete disk access.
A live inventory is best-effort, not an atomic filesystem snapshot: files can
change during traversal.

Memory scales with directory nodes and largest direct files. The snapshot is
not a complete per-file index: it stores 32 direct files per directory and groups
the rest. Live browsing can explicitly read all direct files on demand, with
per-name sizes that can include shared hard-link blocks. Chart depth and node
counts are bounded independently of scan size. The searchable, paged list can
reach every retained directory. A JSON snapshot stores the entire directory inventory
and requires memory proportional to that inventory when imported. Completed
SQLite inventories load metadata and queried pages without hydrating the tree.

## Data and API

Existing known-target reports retain their `whyfull-report` versioned contract.
Filesystem inventories use `whyfull-disk`, schema version 1. The public API
exports `DiskScanner`, `scanFilesystem`, `startViewer`, asynchronous
`saveDiskSnapshot`/`loadDiskSnapshot`, and policy helpers.

```js
import { scanFilesystem, saveDiskSnapshot, releaseDiskSnapshot } from "whyfull"

const snapshot = await scanFilesystem({
  root: "/path/to/folder",
  workers: 4,
  engine: "sync",
  policy: { keep: [], exclude: [] },
  signal: new AbortController().signal,
})
try {
  await saveDiskSnapshot(snapshot, "/tmp/new-disk-snapshot.json")
} finally {
  releaseDiskSnapshot(snapshot)
}
```

Snapshots are ordinary JSON streamed on write and parsed incrementally on read.
The canonical output places one directory per line so the reader can use native
`JSON.parse` per record; minified and pretty JSON use a general streaming parser.
This avoids V8's individual-string size limit. Existing files are never replaced.
Older incomplete/cancelled JSON snapshots remain labelled incomplete when opened
later. New SQLite-backed scans must complete before JSON export; failed or
cancelled work never replaces the completed cache. Do not serialize a changing
inventory. Snapshot imports never continue scanning or read live file lists.

`whyfull --ui --report file.json` and `pnpm viewer --report file.json` accept both
report formats; a single positional file after `--ui` works too. The UI drive
menu includes **Open report…**. Imports stream to owner-only temporary files
(up to 8 GiB), validate before replacing the current document, and clean up those
files afterward. CLI target/cache reports are bounded to 64 MiB, show sections,
measurement lower bounds, drill-downs and tool cleanup advice, and explicitly
label overlapping totals. Finder actions accept only locations in the open report.
Drive changes are restricted to discovered mount roots, with native Trash still
requiring the original `--allow-trash` capability and explicit opt-in.

The local server exposes authenticated status, directory summaries, export,
policy updates, cancellation and rescan endpoints. Directory navigation uses
IDs from the scan; there is no general-purpose filesystem-read endpoint. Tokens
are generated per server session, passed to the browser in a URL fragment, and
stored in tab-local session storage to survive reloads. APIs require a bearer
token and validate Host and Origin; no CORS access is enabled. Static assets are
allowlisted. A restrictive content policy blocks external assets and framing.

### Desktop license

Only viewers started by the desktop app enable `/api/license`; `npx whyfull --ui`
and other CLI viewers report `{ "enabled": false }` and never show license UI.
The desktop app counts distinct days it is opened (30 trial days), then shows a
reminder at most once a day after a completed scan. Nothing is disabled; the
terms still require a license for continued desktop use. Keys are Ed25519-signed
and verified offline from `license.json` beside `config.json`; no request
leaves the machine. Because the webview cannot navigate off-origin, the
`open` action (`{ "action": "open", "page": "buy" }`) asks the server to open a
fixed allowlist of whyfull.app pages (`buy`, `recover`, `legal`) in the default
browser; `checkout` remains an alias for `buy`.

People manage the license in **Settings › License**, or from a terminal with
`whyfull license` (status, `--json`, `activate <key or link>`, `deactivate`,
`buy`). Both read and write the same `license.json`; the command never counts a
trial day. Prices, the trial length, page URLs and license wording all come from
`packages/whyfull/src/license.ts`.

### Local API security

The server listens only on IPv4 loopback (`127.0.0.1`) at an OS-assigned port.
Every launch generates a new cryptographically random 256-bit bearer key. API
requests require `Authorization: Bearer <key>`; cookies, query parameters, an
old session's key, or a key from a different viewer cannot authenticate. The key
is passed in the browser URL fragment, removed from the address bar, and kept
in tab-local session storage. It is never embedded in public assets or reports.
Stopping the server revokes its key. Treat the full launch URL as a secret.

Host must exactly match the listener's address and port, so a domain pointing
at loopback cannot pass a DNS-rebinding request through a spoofed Host. An
Origin header, when present, must exactly match that origin, including the port;
`null` and other local app origins are rejected. Browser API requests must also
carry same-origin Fetch Metadata when those headers are present; navigation,
iframe, same-site/different-origin, and cross-site API requests are rejected.
No CORS or private-network preflight permission is granted. Native clients that
omit browser metadata still need the key. POST bodies must be `application/json`;
ordinary action bodies must be JSON objects of at most 16 KiB, measured in bytes.
Authenticated report imports use their separate streaming size limit.

The HTTP runner accepts fixed diagnostic IDs and strictly validated report
options. It rejects executable, command, args, cwd, env, and other unexpected
fields, and spawns server-selected executables/arguments with `shell: false`.
Report recommendations are displayed as text, never evaluated. Finder uses a
fixed executable and validated inventory/report paths. Real Trash capability
must be granted at CLI startup and still requires explicit mode selection and
a short-lived preview; a POST cannot grant that missing startup capability.

Responses omit server/framework identity headers, use generic authentication
errors, and apply CSP, no-referrer, nosniff, same-origin resource/opener isolation,
and restrictive camera/microphone/location permissions. Public UI assets may
identify the application; hiding its name or port is not an authorization boundary.

A localhost web server cannot prove that a caller is its frontend: native
programs can forge Origin and Fetch Metadata. These checks block hostile browser
origins and clients without the key. A local process that steals the key, a
compromised same-origin page, or malware running with the user's privileges is
outside this boundary. Keep the session short, close the runner when done, and
do not share its authenticated URL. No claim of isolation from same-user malware
or of a complete independent security audit is made.

The browser request checks follow [OWASP's CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
and [Fetch Metadata semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site).

Config updates are explicit UI actions, use private temporary files and atomic
rename, and preserve unrelated settings. Invalid existing settings are never
overwritten. Keep and Exclude are separate policies; removing an ancestor's keep
rule is done in the rules panel. Exclusions apply on the next scan.

## Configuration experiments

After building:

```bash
node scripts/benchmark-filesystem.mjs ~/Library/pnpm/store /tmp/whyfull-benchmark.json
```

The script runs sync metadata with 1/4/8 workers and async metadata with 4 workers.
It records elapsed time, counts, bytes, throughput, errors and sampled process
RSS. All configurations should agree on an unchanged directory. Its sequential
runs are warm-cache observations; memory can include objects retained from prior
configurations. Do not infer cold-cache performance or guaranteed speedups.

For an independent single run:

```bash
whyfull --scan --root ~/Library/pnpm/store --workers 4 --engine sync --json-file /tmp/scan-4.json
```

### Local macOS spike · October 19, 2026

Node 22.23.2, Apple Silicon. Sequential package-store runs, with 918,102 regular
file names, 86,976 directories, 43,107,897,344 allocated bytes, and no read errors.
Counts and byte totals agreed across all four configurations:

| Metadata engine | Workers | Elapsed | Files/second |
| --------------- | ------: | ------: | -----------: |
| Sync            |       1 |  56.4 s |       16,268 |
| Sync            |       4 |  13.5 s |       67,802 |
| Sync            |       8 |   8.4 s |      109,889 |
| Async           |       4 |  18.6 s |       49,239 |

These are warm-cache observations in this run order, not a controlled cold-cache
benchmark. They support the eight-sync-worker default on this machine, not a
universal claim about all disks.

The full Data-volume validation traversed 24,442,231 regular-file names and
3,220,116 directories in 250.5 seconds. It reported 441 read errors and three
excluded mount points. The approximately 2 GiB streamed JSON snapshot reopened
and validated in 11 seconds with the record reader, versus 51 seconds with the
generic streaming parser, retaining the same counts and bytes. The record-reader
process used about 3.5 GiB RSS: inventory memory is still material at this scale.
The measurements were separate warm runs and are not cold-start guarantees.

## Build and verification

`pnpm build` builds the TanStack Start SPA first, then the library, CLI and
filesystem worker. Only `apps/web/dist/client` is copied into the CLI package.
Vite and the Start SSR/prerender server are build tools; production uses the
small authenticated Node HTTP server. Static assets are cached per runner instance so rebuilding locally does not break
an already open viewer. An asset manifest allows hashed JS/CSS,
local fonts and SPA navigation fallbacks. Inline shell scripts receive CSP hashes.
The chart rings load lazily; the horizontal SVG treemap has no chart dependency.
Bundled dependency license texts are included in `dist/viewer/THIRD_PARTY.txt`.
Use Node 22.18+ and pnpm 9 for development. The packaged CLI also requires Node 22.18+; desktop and portable builds bundle Node.

For UI development, start a live backend with `--ui --no-open`, then run
`WHYFULL_DEV_API=http://127.0.0.1:<backend-port> pnpm --filter @whyfull/viewer dev`.
Open `http://127.0.0.1:3000/#<token-from-backend-url>`. The Vite proxy targets the
explicit loopback backend. For packaged verification, run `pnpm build` and use
the CLI URL directly. `pnpm --filter whyfull dev` watches backend code only.

Tests cover allocated sizes, sparse files, hard links, symlink cycles, exclusions,
path boundaries, cancellation, bounded direct-file retention, streamed snapshot
round-trips, private non-overwriting reports, config preservation, local API
authentication, origin/Host rejection, chart byte partitions and file browsing.
Integration tests need permission to bind a loopback port.

Manual release checks: scan a real volume, switch both charts, navigate with
breadcrumbs/list/chart, search and page folders, read all direct files, save and
remove Keep/Exclude rules in a temporary config, pause/export/import a snapshot,
and check mobile layout. macOS has been exercised locally; verify native Windows
and Linux behavior before claiming equivalent platform performance.

### Report actions

CLI reports support tier and shortlist filters, expandable recommendations, and
per-location actions. Choose a recommendation in the action selector and apply
it: shortlist for Trash, mark as useless, keep, or inspect with a scoped live scan.
The same controls are available on child entries through their context menu.
Report marks share the persistent cleanup shortlist with filesystem scans and
retain report sizes (which may overlap). Marking never moves files. Saved reports
stay in demo mode; inspect a folder before reviewing any real native Trash move.
Recommendation text is available to copy, and is never interpreted as shell input.

**Run report** opens the diagnostic runner with adjustable children per location,
exact measurement, cache discovery, and worktree discovery. It runs the bundled
read-only CLI with fixed, validated arguments. The trace retains command status
and errors; successful runs offer **Open report** to display the structured
results. The current document stays open until that action is chosen. Report
output is bounded to 64 MiB, and traces remain bounded to 256 KiB. Options from
the open report are used as the starting point for another run.

The ellipsis menu’s **Minimum file size** setting offers **Show everything**,
**1 MiB** (default), **10 MiB**, and **100 MiB**. It is shared by the explorer and
report viewer and persists in the CLI configuration across restarts.

Files below the selected minimum are hidden from default filesystem lists and individual
chart slices, regardless of filename or the folder's size. Their bytes and counts
still contribute to the inventory; charts combine hidden files into the file
aggregate. Search explicitly or choose **All files** to reveal them in the list.
Report locations and child entries below the same threshold are hidden unless
searching. Entries exactly at the selected minimum remain visible; unknown report sizes remain
visible. Filtering never changes measurements or deletes anything.

### Analysis workspace

The toolbar’s **Analysis** button opens read-only checks without replacing the current folder chart. **Checks & coverage** lists the CLI’s resolved known-location definitions (including custom targets), measurement status, optional cache / large-folder / worktree coverage, and individual system checks with Run buttons. **Findings** shows measured locations, worktree states, uncertainty, child measurements, and reference recommendations. **Trace** retains command output and failures.

Storage analysis exposes the CLI’s `--top`, `--exact`, cache scan, `--discover`, and worktree options. The most recent successful generated report is available under Findings without importing it as the active document; loaded CLI reports are also supported. System checks use the home volume on the runner’s machine. Cached or imported results show their original timestamp and platform.

**Copy context** and **Copy results** serialize observations, paths, sizes, partial / denied flags, classifications, and relevant worktree caveats as JSON data. They explicitly omit target hints, recommendation commands, and executable cleanup instructions, including nested child fields. Reference recommendations remain visible for review and are never executed from this workspace. Copying a system trace wraps its recorded output and run status as diagnostic observations.
