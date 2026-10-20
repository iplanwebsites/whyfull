# Local filesystem viewer

The browser UI and scanner are JavaScript, built from the repository's TypeScript
library and a React frontend. No Rust toolchain, native addon, hosted
service, CDN, or Electron installation is needed.

## Launch

```sh
npx whyfull ui
npx whyfull app
npx whyfull ui --root ~/Downloads
npx whyfull ui --report report.json
npx whyfull ui report.json
```

`ui` and `app` are aliases for `--view`. Both start the bundled local server,
open the user's default browser, and scan the home directory unless another root
or a saved report is selected. Use `--no-open` to print the private viewer URL
without launching a browser. Keep the terminal running; Ctrl+C stops the viewer.
All existing viewer options, including `--config` and `--allow-trash`, work with
either command. Demo mode remains the default.

## Design

The two views follow familiar disk-navigation conventions:
[Filelight's](https://apps.kde.org/filelight/) concentric folder rings and
[GrandPerspective's](https://grandperspectiv.sourceforge.net/) proportional rectangles. Both
share the same current directory, breadcrumbs, ranked list, and details panel.
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
The drive selector defaults to macOS Data and lists other mounted volumes; choosing
a drive cancels the previous scan and starts a fresh inventory in demo mode.
It also opens saved JSON reports without restarting the runner. View modes, Finder,
appearance and scan actions in an ellipsis menu. Right-click a breadcrumb, list
entry, treemap tile or ring to open its Base UI context menu. Directory marks
(`trash` or `useless`; legacy `delete` marks are migrated) are saved in the configuration separately from keep/exclude
rules. **Cleanup shortlist** in the ellipsis menu shows all saved marks across scans,
including folders outside the current inventory with unknown sizes. Browse measured
folders, reveal them in Finder, or clear marks individually. Marks are review metadata;
they never move files. Native cleanup always moves to Trash and starts in demo mode.
Finder accepts only inventory directory IDs, report locations or saved shortlist paths,
rechecks the live directory, resolves macOS path aliases, and runs `/usr/bin/open -R`
without a shell. Missing folders, permission failures and launch errors show red toasts.
Start the Node.js runner with `node packages/whyfull/dist/cli.mjs --view --report file.json`
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
Large treemap blocks scale up the count for readability. Tooltips and accessible
labels retain exact counts; file-only groups preserve counts across chart limits.

Sizes use whole MiB and at most one decimal for GiB/TiB. When the current folder
or report section reaches a TiB, GiB values use whole numbers too. Zooming into a
smaller folder restores useful precision; charts and the ranked list share a scale.

**Diagnostics** in the ellipsis menu runs individual read-only commands: disk usage,
macOS volume information, local snapshot listing, system storage information, and
the whyfull known-cache report. Each command has a play button, live stdout/stderr,
exit status, stop control, and copyable trace. Commands run on the local Node.js
runner by fixed ID without a shell or arbitrary command input. Traces stay in memory
for the runner session, are bounded, and survive switching commands or closing the
panel. Failed commands show a red toast; long-running commands have timeouts.

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
reach every retained directory. A snapshot stores the entire directory inventory
and still requires memory proportional to that inventory when loaded.

## Data and API

Existing known-target reports retain their `whyfull-report` versioned contract.
Filesystem inventories use `whyfull-disk`, schema version 1. The public API
exports `DiskScanner`, `scanFilesystem`, `startViewer`, asynchronous
`saveDiskSnapshot`/`loadDiskSnapshot`, and policy helpers.

```js
import { scanFilesystem, saveDiskSnapshot } from "whyfull"

const snapshot = await scanFilesystem({
  root: "/path/to/folder",
  workers: 4,
  engine: "sync",
  policy: { keep: [], exclude: [] },
  signal: new AbortController().signal,
})
await saveDiskSnapshot(snapshot, "/tmp/new-disk-snapshot.json")
```

Snapshots are ordinary JSON streamed on write and parsed incrementally on read.
The canonical output places one directory per line so the reader can use native
`JSON.parse` per record; minified and pretty JSON use a general streaming parser.
This avoids V8's individual-string size limit. Existing files are never replaced.
Incomplete/cancelled scans remain labelled incomplete when opened later. Save
snapshots after a scan completes or is cancelled; do not serialize a changing
inventory. Snapshot imports never continue scanning or read live file lists.

`whyfull --view --report file.json` and `pnpm viewer --report file.json` accept both
report formats; a single positional file after `--view` works too. The UI drive
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
Use Node 22.18+ and pnpm 9 for development; packaged CLI code targets Node 18.15+.

For UI development, start a live backend with `--view --no-open`, then run
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
