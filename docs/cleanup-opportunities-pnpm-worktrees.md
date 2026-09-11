# Cleanup opportunities: pnpm stores and dead git worktrees

Research notes and an implementation plan for two blind spots in the current
whyfull target map. Numbers below come from one real machine (macOS 15,
pnpm 9/10/11 mixed, heavy AI-agent use) on 2026-09-11 and are only there to
show the shape of the problem.

## TL;DR

| Finding                                                                             | On this machine                                                                                    | Reclaimable                                       | Why whyfull misses it today                                               |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| pnpm keeps one store folder **per store-format version** and never deletes old ones | `store/v3` 4.0 GB (untouched since 2024-06), `store/v10` 23 GB, `store/v11` 9.7 GB                 | v3 entirely, v10 once every project is on pnpm 11 | Reported as one 44 GB blob; `pnpm store prune` never touches old versions |
| pnpm has a second cache tree (registry metadata, dlx) outside the store             | `~/Library/Caches/pnpm` 1.3 GB                                                                     | all of it                                         | not in the target map                                                     |
| pnpm-managed Node runtimes and self-managed pnpm binaries                           | `~/Library/pnpm/nodejs` 1.6 GB (5 versions), `.tools` 203 MB, `package-manager-store` 122 MB       | old versions                                      | lumped into "pnpm store"                                                  |
| AI coding tools create git worktrees in six different places and rarely clean up    | 71 linked worktrees, ~225 GB apparent                                                              | most: 33 of 34 in one repo untouched for 38+ days | no worktree awareness at all                                              |
| Worktree `node_modules` on APFS are **clones** of the pnpm store, not hard links    | 22 GB of Codex worktree `node_modules` share extents with the store                                | apparent size is not real cost                    | `measure()` dedups by inode; clones have distinct inodes                  |
| Directory mtime is a bad "last used" signal for worktrees                           | a worktree's root mtime is bumped by any top-level file write, including the tool's own lock files | —                                                 | atime/mtime of the root is what `children()` reports                      |
| Agent app data grows without bound                                                  | `~/.codex` 85 GB (57 GB worktrees, 18 GB sessions, 5.9 GB sqlite), `~/.claude/projects` 3.3 GB     | judgement                                         | only the desktop app bundle is tracked                                    |

## Part 1: pnpm

### 1.1 Where pnpm actually writes

pnpm has four independent trees. The current target treats the first as the
whole story.

| Tree                                           | macOS                                                                           | Linux                              | Windows                            | Env override                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Content-addressable store                      | `~/Library/pnpm/store/v<N>`                                                     | `~/.local/share/pnpm/store/v<N>`   | `%LOCALAPPDATA%\pnpm\store\v<N>`   | `store-dir`, `$PNPM_HOME/store`, `$XDG_DATA_HOME/pnpm/store`; `pnpm_config_store_dir` (v11+) or `npm_config_store_dir` (older) |
| Per-volume fallback store                      | `<mount>/.pnpm-store`                                                           | same                               | same                               | created when the project is on a different filesystem than the home store (hard links cannot cross volumes)                    |
| Sandbox fallback store                         | `<project>/node_modules/.pnpm-store`                                            | same                               | same                               | when nothing above the project accepts a hard link                                                                             |
| Metadata + dlx cache                           | `~/Library/Caches/pnpm`                                                         | `~/.cache/pnpm`                    | `%LOCALAPPDATA%\pnpm-cache`        | `cache-dir`, `$XDG_CACHE_HOME/pnpm`                                                                                            |
| Node runtimes (`pnpm env`, now `pnpm runtime`) | `~/Library/pnpm/nodejs/<ver>` + `nodejs_current` symlink                        | `~/.local/share/pnpm/nodejs/<ver>` | `%LOCALAPPDATA%\pnpm\nodejs\<ver>` | `$PNPM_HOME/nodejs`                                                                                                            |
| Self-managed pnpm binaries                     | `~/Library/pnpm/.tools/@pnpm+<os>-<arch>/<ver>` and `package-manager-store/v11` | same under `~/.local/share/pnpm`   | same under `%LOCALAPPDATA%\pnpm`   | `manage-package-manager-versions` (default on since pnpm 10)                                                                   |
| Global installs                                | `~/Library/pnpm/global/<n>/node_modules`                                        | `~/.local/share/pnpm/global`       | `%LOCALAPPDATA%\pnpm\global`       | `$PNPM_HOME/global`                                                                                                            |

Verified locally: `~/Library/Caches/pnpm` contains `v11/metadata` (1.0 GB),
`v11/metadata-full` (347 MB), `dlx/` (empty here; expires after
`dlx-cache-max-age`, default one day) and `lockfile-verified.jsonl`.

`.tools` and `package-manager-store` are undocumented internal layouts, but
they exist on any machine that has run pnpm 10+ with a `packageManager` field.
`.tools/@pnpm+macos-arm64/{9.15.0,9.15.4,10.11.0}` here are older self-managed
binaries that nothing pins any more.

### 1.2 Store versions are never garbage collected

Each pnpm major that changes the store format writes a new sibling folder and
never reads the old one:

| Store folder | Written by       | Notes                                                                                      |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------ |
| `v3`         | pnpm 3 through 9 | per-package JSON index under `index/`                                                      |
| `v10`        | pnpm 10          |                                                                                            |
| `v11`        | pnpm 11+         | single `index.db` (SQLite), `projects/` symlinks back to every project that linked from it |

`pnpm store prune` only removes unreferenced packages inside the store that
the _running_ pnpm uses. It will never delete `store/v3`. There is no pnpm
command that does; the correct cleanup is `rm -rf` of the whole version folder
once no project's `node_modules/.modules.yaml` names it as `storeDir`.

Locally, the shell's default `pnpm` is 9.12 (so `pnpm store path` still prints
`store/v3`), but every recent project pins pnpm 11 via `packageManager` and
links from `store/v11`. `store/v3` has an mtime of 2024-06-15 and an atime in
April 2026, which is consistent with "read by a scan, written by nobody".

### 1.3 APFS clones defeat inode-based dedup

`measure()` counts a multiply-linked inode once, which is correct for hard
links. On macOS pnpm's default `package-import-method=auto` resolves to
`clonefile(2)` (copy-on-write), not `link(2)`. Verified locally:

```
$ stat -f 'nlink=%l' node_modules/.pnpm/picocolors@1.1.1/node_modules/picocolors/package.json
nlink=1
$ python3 cloneid.py <store file> <main checkout copy> <worktree copy>
65 /Users/felix/Library/pnpm/store/v11/files/94/95ec…
65 node_modules/.pnpm/picocolors@1.1.1/node_modules/picocolors/package.json
65 .claude/worktrees/sweep-s1/node_modules/.pnpm/picocolors@1.1.1/…/package.json
$ python3 cloneid.py package.json    # never cloned
0 package.json
```

Three different inodes, one clone ID, one set of extents on disk. Every
`node_modules` that pnpm linked on this volume reports its full apparent size
to `du`, to Finder, and to whyfull, while its real incremental cost is close to
zero until a file is modified. `st_blocks` is not adjusted for clones.

Consequences:

- Sizes for `node_modules/.pnpm` trees on macOS are upper bounds. Deleting a
  worktree whose `node_modules` came from the store frees far less than
  reported. Deleting the store itself (or an old store version whose clones
  are still alive) frees nothing until the last clone goes.
- Node has no `getattrlist` binding, so whyfull cannot read
  `ATTR_CMNEXT_CLONEID` without a native addon or a child process. Both are
  against the project's design. The practical answer is a heuristic and an
  honest label, see 3.2.
- The same applies to `pnpm` on Linux btrfs/xfs with reflinks. On ext4 pnpm
  hard-links and the existing inode dedup is exact.

### 1.4 Proposed pnpm target changes

Split the single `pnpm` target into a group so each tree gets its own tier
and hint, and so the store drills into version folders rather than into
`store`, `nodejs`, `.tools`:

| id                  | path (darwin)                                                              | tier      | hint                                                                |
| ------------------- | -------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| `pnpm-store`        | `~/Library/pnpm/store` (+ `$PNPM_HOME/store`, `$XDG_DATA_HOME/pnpm/store`) | AUTO      | `pnpm store prune`; old `v*` folders: see store-version routine     |
| `pnpm-store-volume` | `/Volumes/*/.pnpm-store`, `~/.pnpm-store`                                  | AUTO      | same                                                                |
| `pnpm-cache`        | `~/Library/Caches/pnpm`                                                    | AUTO      | `pnpm cache delete`; `dlx/` expires on its own                      |
| `pnpm-nodejs`       | `~/Library/pnpm/nodejs`                                                    | JUDGEMENT | `pnpm env list` / `pnpm env remove <ver>` (pnpm 11: `pnpm runtime`) |
| `pnpm-tools`        | `~/Library/pnpm/.tools`, `~/Library/pnpm/package-manager-store`            | AUTO      | delete versions no `packageManager` field pins; pnpm re-downloads   |
| `pnpm-global`       | `~/Library/pnpm/global`                                                    | JUDGEMENT | `pnpm ls -g`, `pnpm rm -g <pkg>`                                    |

Use `childrenDir: "store"` semantics but at the version level: with `--top`,
the store target's children are `v3`, `v10`, `v11`, each with size and mtime.

**Store-version routine** (new, cheap, no walk needed):

1. Read `store/` and list `v*` entries with `statSync().mtimeMs`.
2. Mark every version except the newest as `stale` when its mtime is older
   than the newest version's _creation_ (birthtime) or older than 90 days.
3. Optionally confirm by scanning the newest store's `projects/` symlinks
   (v11 keeps them) and any discovered project's `node_modules/.modules.yaml`
   for `storeDir`; a version nobody names is safe.
4. Report: `store/v3  4.0 GB  last written 2024-06-15  no project links here
→ rm -rf ~/Library/pnpm/store/v3`.

Keep the existing file budget: the store here is 900k files; version folder
sizes with budget are still lower bounds and must say so.

### 1.5 Corrections to sibling targets found during research

- **Turborepo** has no global cache dir. `.turbo/cache` is per repo. Do not add
  `~/Library/Caches/turbo`.
- **Nx** moved from `node_modules/.cache/nx` to `<repo>/.nx/cache` in Nx 17.
- **Yarn Berry** defaults to `enableGlobalCache: false`, so the bulk usually
  sits in each project's `.yarn/cache`, not `~/.yarn/berry/cache`.
- **Bun** `~/.bun/install/cache` and `~/.bun/install/global` are not tracked.
- **Deno** `~/Library/Caches/deno` / `~/.cache/deno` / `%LOCALAPPDATA%\deno`.
- **Corepack** `~/.cache/node/corepack` / `%LOCALAPPDATA%\node\corepack`.
- **Node version managers**: nvm `~/.nvm/versions/node`, Volta `~/.volta`,
  fnm `~/Library/Application Support/fnm` and `~/.local/share/fnm`.
- **npm** already covered; `~/.npm/_npx` is the npx cache and grows on its own.

## Part 2: dead git worktrees

### 2.1 Why worktrees are a distinct problem

A linked worktree is a full checkout plus its own `node_modules`, build
output, `.turbo`, `.next`, `dist`, Xcode products. It shares only the object
database with the main repo. Agent tools create one per task and most do not
remove it when the task ends. This machine:

| Location                                                     | Worktrees        | Apparent size                                                      |
| ------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------ |
| `~/.codex/worktrees/<id>/<repo>` (Codex desktop)             | 13               | 57 GB                                                              |
| `hybrid-audio-engine/.claude/worktrees` (Claude Code)        | 13               | 76 GB                                                              |
| `kick-mono/.claude/worktrees` (Claude Code subagents)        | 33               | 22 GB, 29 of them identical 373 MB checkouts untouched for 38 days |
| `invt-mono`, `tinbox-mono`, `mutek-2026` `.claude/worktrees` | 7                | 20 GB                                                              |
| `kick-mono copy/.claude/worktrees`                           | 1                | 2.1 GB, `.git` file points at the _original_ repo's admin dir      |
| `kick-mono-gitonly-11aug2026/.git/worktrees`                 | 34 registrations | a `.git`-only backup whose registry is entirely stale              |

Two things make the raw numbers misleading, which is the user's observation:

1. `node_modules` inside a worktree is APFS-cloned from the pnpm store (1.3),
   so 22 GB of Codex worktree `node_modules` costs almost nothing extra, while
   the 12 GB `hybrid-audio-engine` worktree with real build products costs
   every byte.
2. The root directory's mtime says nothing useful. Claude Code's `sweep-s1`
   root mtime is 10:11, its `.git/worktrees/sweep-s1/HEAD` mtime is 10:05,
   its last commit 10:05:34. The root mtime moved because the tool wrote a
   lock or log file. For a worktree that an agent abandoned, the root mtime
   can also be _older_ than the real last activity, because edits happen deep
   in `src/`. Neither `atime` nor root `mtime` should be shown as "last used".

### 2.2 Git mechanics we can rely on (no child processes needed)

| Fact                                                                                     | Where to read it                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A linked worktree root has a `.git` **file** with `gitdir: <main>/.git/worktrees/<name>` | one `readFileSync`, distinguishes it from a submodule whose `.git` file says `gitdir: ../.git/modules/<name>`                                                                                   |
| The main repo lists every worktree it knows about                                        | `<main>/.git/worktrees/<name>/gitdir` contains the absolute path of the worktree's `.git` file                                                                                                  |
| Current branch or detached state                                                         | `<main>/.git/worktrees/<name>/HEAD` is either `ref: refs/heads/<branch>` or a raw SHA                                                                                                           |
| Last git activity                                                                        | mtime of that `HEAD` file (moves on commit/checkout/reset) and of `index` (moves on add/stage/checkout). This is the "real" last-modified date for a worktree                                   |
| Locked by a tool                                                                         | presence of `<main>/.git/worktrees/<name>/locked`; Claude Code locks while a session is live                                                                                                    |
| Stale registration                                                                       | `gitdir` points at a path that no longer exists; `git worktree prune` removes only the admin folder                                                                                             |
| Orphan worktree                                                                          | the `.git` file's target admin folder no longer exists, or exists but its `gitdir` points somewhere else (the `kick-mono copy` case). Git commands inside it fail; the directory is dead weight |
| Bare-repo layouts                                                                        | `<proj>/.bare` plus siblings; `.git` file at each sibling points into `.bare/worktrees/<name>`; same detection                                                                                  |
| Uncommitted work                                                                         | requires diffing the index against the tree; out of scope for a read-only fs walk. Report `index` mtime newer than `HEAD` mtime as "staged or checked out after last commit", nothing stronger  |

Because every `.git` file names its main repo, and every main repo's admin
dir names every other worktree, **one hit anywhere in a cluster reveals the
whole cluster**. That is what makes a heuristic scan viable: we do not need to
find every worktree, only one per cluster.

### 2.3 Where tools put worktrees

Verified or documented defaults. "In repo" entries are relative to the main
checkout, "home" entries are absolute.

| Tool                                  | Location                                                                                                                                       | Cleanup behaviour                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code CLI + desktop             | `<repo>/.claude/worktrees/<name>` (desktop: configurable "Worktree location")                                                                  | removes unnamed clean worktrees on exit; periodic sweep of subagent worktrees older than `cleanupPeriodDays` if clean; named or dirty ones stay |
| Codex desktop app                     | `$CODEX_HOME/worktrees/<id>/<repo>` = `~/.codex/worktrees/…` (configurable "Worktree root")                                                    | none observed                                                                                                                                   |
| Codex CLI                             | none built in; guides suggest `~/worktrees/<proj>/<branch>`                                                                                    | manual                                                                                                                                          |
| Gemini CLI                            | `<repo>/.gemini/worktrees/<name>`                                                                                                              | deletes only if no uncommitted changes and no new commits                                                                                       |
| Windsurf / Cascade / Devin desktop    | `~/.windsurf/worktrees/<repo>/<random>`                                                                                                        | cap of 20 per workspace, LRU eviction                                                                                                           |
| Cursor parallel agents                | undocumented path; `cursor.worktreeMaxCount` default 25, periodic cleanup                                                                      | look for `.cursor/worktrees` and `~/.cursor/worktrees` anyway                                                                                   |
| Conductor                             | `~/conductor/workspaces/<repo>/<name>` (older: `<repo>/.conductor/`)                                                                           | none documented                                                                                                                                 |
| Vibe Kanban                           | `~/.vibe-kanban/workspaces/<id>/<repo>`; clones in `~/.vibe-kanban/repos/<id>`                                                                 | none confirmed                                                                                                                                  |
| GitHub Copilot coding agent (VS Code) | `../copilot-worktree/task-<id>` sibling                                                                                                        | cloud runs are ephemeral; local ones stay                                                                                                       |
| Zed                                   | `../worktrees` sibling of repo (`git.worktree_directory`)                                                                                      | none documented                                                                                                                                 |
| JetBrains Junie                       | `../<project>-junie-wt-NN` siblings                                                                                                            | known to leave stale entries                                                                                                                    |
| Kiro (community orchestration)        | `<repo>/.worktrees/<spec>`                                                                                                                     | none                                                                                                                                            |
| OpenCode plugin                       | `<repo>/.opencode/worktrees`                                                                                                                   | auto-commits and removes on exit                                                                                                                |
| Generic / manual                      | `../<branch>` siblings, `<repo>/.worktrees`, `<repo>/worktrees`, `~/worktrees`, `~/.worktrees`, bare layout `<proj>/.bare` + `<proj>/<branch>` | manual                                                                                                                                          |
| Sculptor, Terragon, Copilot cloud     | containers or remote; nothing local                                                                                                            | —                                                                                                                                               |

### 2.4 Repo discovery without walking the disk

The scan must not crawl the filesystem. The user's proposal is right: seed
from the usual suspects, then let worktree metadata expand the set.

**Seeds (all cheap, all shallow):**

1. Home-level tool roots from the table above. These are exact paths; list
   their children two levels deep (`<id>/<repo>`).
2. Common code roots, two to three levels deep only:
   `~/code ~/dev ~/src ~/projects ~/repos ~/work ~/git ~/web ~/Developer
~/Documents/GitHub ~/GitHub ~/Sites ~/workspace ~/go/src`, plus the current
   working directory and its parent. At each level look only for a `.git`
   entry (file or dir) and for the in-repo tool folders (`.claude/worktrees`,
   `.gemini/worktrees`, `.cursor/worktrees`, `.worktrees`, `worktrees`,
   `.conductor`, `.opencode/worktrees`, `.bare`). Never descend into
   `node_modules`, `.git`, `dist`, `build`, `target`, `.next`, `Library`.
3. Explicit extra roots from `~/.config/whyfull/targets.json` (new optional
   `worktreeRoots` array) or a `--worktree-root <dir>` flag, repeatable.
4. Recently used repos from tool state files, when present and parseable:
   `~/.claude/projects/<encoded path>/` directory names encode the repo path;
   `~/.codex/worktrees/*/*/.git` files name their main repos;
   VS Code / Cursor `storage.json` `openedPathsList`. Read-only, best effort,
   skipped silently when absent.

**Expansion:** for every `.git` file found, resolve `gitdir:` to the main
repo, then read `<main>/.git/worktrees/*/gitdir` to enumerate every sibling,
including ones in locations no seed would have found (Codex worktrees under
`~/.codex` were found from `~/web/.../hybrid-audio-engine/.git/worktrees`, and
vice versa). For every main repo found, do the same. Deduplicate by realpath.

Budget: the whole discovery pass on this machine touches a few hundred
directory reads. The expensive part is sizing, which is bounded by
`measure()` budgets as today.

### 2.5 Classifying each worktree

For each worktree produce:

| Field                       | Source                                                                                                                            | Notes                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`, `mainRepo`, `name`  | `.git` file + admin dir                                                                                                           |                                                                                                                                                                                   |
| `tool`                      | path pattern match                                                                                                                | `claude`, `codex`, `gemini`, `windsurf`, `cursor`, `conductor`, `vibe-kanban`, `copilot`, `junie`, `zed`, `manual`                                                                |
| `state`                     | see 2.2                                                                                                                           | `linked`, `orphan` (admin dir missing or points elsewhere), `stale` (registered but directory missing; costs ~0 bytes, listed so `git worktree prune` can be suggested), `locked` |
| `branch` / `detached`       | admin `HEAD`                                                                                                                      | Codex worktrees are detached; Claude Code's use `worktree-<name>` or the sweep branch                                                                                             |
| `lastGitActivity`           | max(mtime of admin `HEAD`, admin `index`)                                                                                         | the honest "last modified"; never the root dir mtime                                                                                                                              |
| `dirtyHint`                 | `index` mtime > `HEAD` mtime                                                                                                      | weak signal, labelled as such                                                                                                                                                     |
| `bytes`, `files`, `partial` | `measure()` on the root with the usual budget                                                                                     |                                                                                                                                                                                   |
| `sharedBytes`               | `measure()` of `node_modules` when `node_modules/.modules.yaml` exists and its `storeDir` is on the same `st_dev` as the worktree | labelled "shared with pnpm store (APFS clone / hard link); freeing it reclaims little"                                                                                            |
| `ageDays`                   | now − `lastGitActivity`                                                                                                           |                                                                                                                                                                                   |

Ranking: sort by `bytes − sharedBytes` descending, then by age. Group by main
repo so the report reads "hybrid-audio-engine: 26 worktrees, 133 GB apparent,
~110 GB real, 19 older than 7 days".

Suggested hints, per state:

- linked, not locked: `git -C <main> worktree remove <path>` (add
  `--force` if `dirtyHint`), then `git -C <main> branch -d <branch>` if the
  branch is merged. Tier JUDGEMENT: it may hold unpushed commits.
- linked, locked: "a tool session may be live; `git worktree unlock` first".
  Tier APP.
- orphan: `rm -rf <path>`; nothing in git references it. Tier JUDGEMENT
  (uncommitted files could still be there).
- stale: `git -C <main> worktree prune`. Tier AUTO, ~0 bytes.
- Tool-specific: Claude Code worktrees older than `cleanupPeriodDays` that
  are still present are the ones the sweep skipped because they were dirty or
  named; say so.

### 2.6 CLI and JSON shape

- `whyfull --worktrees` runs the discovery and adds a "Git worktrees" section
  to the report, after the tier groups. Off by default until it has been used
  on enough machines; then fold into the default run if it stays under a
  second on the seeds.
- `--worktree-root <dir>` (repeatable) adds seeds. `--worktree-age <days>`
  filters (default 0 = show all, sorted).
- JSON: `report.worktrees = { clusters: [{ mainRepo, worktrees: [...] }],
seeds: [...], truncated: boolean }`.
- Library: `export function findWorktrees(opts): WorktreeResult` from a new
  `src/worktrees.ts`, pure `node:fs`, no `child_process`, same constraints as
  `scan.ts`.

## Part 3: agent app data (adjacent, cheap to add)

Not worktrees, but found on the way and larger than most tracked targets:

| id                   | path (darwin)                                                                                                     | here   | tier      | hint                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ------ | --------- | --------------------------------------------------------------------------------------- |
| `codex-home`         | `~/.codex` (drill: `worktrees`, `sessions`, `archived_sessions`, `*.sqlite`, `generated_images`, `logs_*.sqlite`) | 85 GB  | JUDGEMENT | sessions and thread history are conversation logs; worktrees via the routine above      |
| `claude-code-home`   | `~/.claude` (drill: `projects`, `file-history`, `shell-snapshots`, `backups`)                                     | 3.3 GB | JUDGEMENT | `projects/` is per-repo transcripts; `cleanupPeriodDays` in settings controls retention |
| `cursor-home`        | `~/.cursor`, `~/Library/Application Support/Cursor`                                                               | 0.6 GB | APP       |                                                                                         |
| `vibe-kanban`        | `~/.vibe-kanban` (`repos`, `workspaces`)                                                                          | 86 MB  | JUDGEMENT | clones + worktrees                                                                      |
| `gemini-home`        | `~/.gemini`                                                                                                       | 27 MB  | JUDGEMENT |                                                                                         |
| `windsurf-worktrees` | `~/.windsurf/worktrees`                                                                                           | —      | JUDGEMENT | LRU-capped at 20                                                                        |
| `conductor`          | `~/conductor/workspaces`                                                                                          | —      | JUDGEMENT |                                                                                         |

## Part 4: implementation plan

Ordered by value per line of code.

1. **pnpm target split + store-version routine** (1.4). Pure data plus ~60
   lines. Immediately explains 44 GB as 4 + 23 + 9.7 + 1.6 + …, and names
   `store/v3` as dead.
2. **`sharedBytes` heuristic** (1.3, 2.5). `measure()` gains an optional
   `sharedRoots` check via `.modules.yaml`; the report shows "of which N GB
   shared with pnpm store". Applies to every `node_modules` whyfull ever
   drills into, not just worktrees.
3. **`src/worktrees.ts` + `--worktrees`** (2.4 to 2.6). Seeds, expansion,
   classification, rendering. Tests with fixture repos built from plain files
   (write `.git` files and admin dirs by hand; no `git` binary needed in
   tests, which also keeps CI hermetic).
4. **Agent app-data targets** (Part 3). Pure data.
5. **Sibling corrections** (1.5). Pure data.

Out of scope, deliberately: reading the git index to compute real dirtiness,
resolving commit dates from packed objects, calling `getattrlist`. Each would
need a native binding or a child process.

## Appendix: verification commands used

```bash
# store versions and pnpm trees
ls ~/Library/pnpm/store; du -sh ~/Library/pnpm/store/*; stat -f '%Sa %Sm' ~/Library/pnpm/store/v3
ls ~/Library/Caches/pnpm ~/Library/pnpm/.tools/* ~/Library/pnpm/package-manager-store/*

# a project's store binding and import method
grep -E 'storeDir|packageImportMethod' node_modules/.modules.yaml

# clone vs hard link: nlink=1 on every pnpm-linked file means clonefile()
find node_modules/.pnpm -type f | head -2000 | xargs stat -f '%l' | sort | uniq -c

# worktree registry, stale entries, locks, detached state
git worktree list --porcelain
for w in .git/worktrees/*/; do t=$(cat "$w/gitdir"); [ -e "$t" ] || echo "stale: $w"; done

# honest last-activity date for a worktree
stat -f '%Sm' .git/worktrees/<name>/HEAD .git/worktrees/<name>/index
```

The APFS clone ID check used a 20-line Python `ctypes` call to `getattrlist`
with `ATTR_CMNEXT_CLONEID` and `FSOPT_ATTR_CMN_EXTENDED`; clone ID `0` means
the file was never cloned. It is a verification aid only and is not part of
the tool.

## Part 5: faster sizing on macOS (research only, not implemented)

The maintainer asked whether macOS can hand back a directory's total size
without counting every file. Findings, with the practical ranking:

| Option                                                                                                                                                                      | Verdict                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APFS "fast directory sizing" (`INODE_MAINTAIN_DIR_STATS`, `j_dir_stats_val_t.total_size`)                                                                                   | Real on-disk structure, **no public API** to enable or read it. Can only be set on an empty directory at creation, and Apple's own engineers report the `DIRSTAT_FAST_ONLY` path falls back to a full walk (Radar 32794924). Finder does not use it. Dead end.                                                                                 |
| `getattrlist` directory attributes (`ATTR_DIR_ALLOCSIZE`, `ATTR_DIR_DATALENGTH`, `ATTR_CMN_ALLOCSIZE`)                                                                      | Per-object only; `ATTR_DIR_ALLOCSIZE` is always 0 on APFS. Not recursive.                                                                                                                                                                                                                                                                      |
| `NSURLTotalFileAllocatedSizeKey` and friends                                                                                                                                | Per file. Enumerators still walk.                                                                                                                                                                                                                                                                                                              |
| Spotlight (`mdfind`, `kMDItemPhysicalSize`)                                                                                                                                 | Returns paths, not sums, and dotfolders, `~/Library` caches and `node_modules` are commonly unindexed. Unreliable for exactly the directories whyfull cares about.                                                                                                                                                                             |
| `getattrlistbulk(2)`                                                                                                                                                        | The real macOS win: one syscall returns names, type, allocated size, link count and file id for a whole batch, fusing `readdir` + `lstat`. Published benchmarks show 2 to 6x over `du`. Node and libuv do not expose it; reachable via `koffi` (prebuilt FFI, no compiler) or an N-API addon, with fallback to the current walker. macOS only. |
| Sampling hash-sharded stores                                                                                                                                                | pnpm `files/xx`, HF `blobs`, npm `_cacache` are sharded by hash prefix into 256 near-uniform buckets. Measuring 1/16 of buckets and extrapolating turns a 900k-file walk into ~55k files and must be labelled "estimated". Cheapest large win, pure JS.                                                                                        |
| Cache results keyed by top-level directory mtimes                                                                                                                           | Skips unchanged subtrees on repeat runs. Directory mtime only moves on immediate child add/remove, so pair it with a small re-verification sample.                                                                                                                                                                                             |
| Tool-native reports (`docker system df`, `pip cache info`, `pnpm store status`, `cargo cache --info`, `brew cleanup -n`, `diskutil apfs list`, `tmutil listlocalsnapshots`) | Accurate and instant, but every one is a child process, which the current design forbids. `diskutil` and `tmutil` are the only way to see APFS local snapshots and "purgeable" space, which no walk can attribute.                                                                                                                             |
| Other platforms                                                                                                                                                             | Linux `btrfs qgroup` / `zfs list` account per subvolume natively; `io_uring` batches `statx` but not `getdents`. Windows: reading the NTFS MFT directly (the WizTree approach) is the true equivalent of what APFS never shipped, and needs elevation.                                                                                         |

A benchmark of the current walker against `du`, a compiled `getattrlistbulk`
helper, and bucket sampling on this machine's pnpm stores was started and is
recorded as a to-do below rather than a result.

## What shipped

- `pnpm` target split into store, per-volume store, metadata cache, Node
  runtimes, self-managed binaries, package-manager store and global installs.
  The store target drills into `v3` / `v10` / `v11` and marks stale versions
  with an `rm -rf` note (`storeVersions()` in `src/pnpm.ts`).
- New targets: Bun, Deno, Corepack, nvm, Volta, fnm, and an "AI coding
  agents" group (`~/.codex`, `~/.claude`, `~/.cursor`, `~/.vibe-kanban`,
  `~/.gemini`, `~/.windsurf/worktrees`, `~/conductor/workspaces`).
- `--worktrees`, `--worktree-root`, `--worktree-age` and `findWorktrees()` in
  `src/worktrees.ts`: seeds, metadata expansion, classification, clustering,
  and per-worktree hints. Pure `node:fs`, no child processes.
- `sharedBytes`: any drilled `node_modules` whose `.modules.yaml` names a pnpm
  store on the same volume is annotated as shared (APFS clone or hard link).
  Handles both the pnpm ≤11 YAML and the pnpm 12 JSON shape of that file.
- `measure()` now reports `partial` when `maxDepth` cuts a subtree, so
  depth-limited targets show `≥` instead of a silently wrong number.
- Hints never include `--force`; `git worktree remove` and `git branch -d`
  refusing dirty or unmerged state is the safety net.

Deviation from spec 2.5, on purpose: a registration in some repo's
`.git/worktrees/` does not make a checkout an orphan when the checkout's own
`.git` file points at a different, existing repo. A `.git`-only backup of
`kick-mono` carried a full copy of the live repo's registry and, under the
literal rule, 33 healthy worktrees were labelled orphans with `rm -rf` hints.
The worktree's `.git` file is the authority on ownership. There is a
regression test for this.

## Future improvements

1. **Sizing accuracy under budgets.** With the default 120k-file budget the
   pnpm store reads `≥2.5 GB` for 44 GB and each worktree `≥600 MB` for
   9 GB. Implement bucket sampling for hash-sharded stores and raise or
   remove the worktree budget behind a flag; finish and record the walker vs
   `getattrlistbulk` vs sampling benchmark.
2. **`getattrlistbulk` fast path** on macOS via `koffi`, falling back to the
   current walker. Include `ATTR_CMNEXT_CLONEID` so clone-shared bytes are
   measured instead of inferred from `.modules.yaml`.
3. **Result cache** keyed by target path and top-level mtimes, for repeat runs.
4. **Stale pnpm store confirmation** by reading every discovered project's
   `.modules.yaml` `storeDir` (and `store/v11/projects/` symlinks) before
   calling a version dead.
5. **Dirty detection** for worktrees by parsing the git index against the
   working tree, so the "index touched after last commit" hint can become a
   real answer.
6. **APFS snapshots and purgeable space** as a first-class line, which needs a
   decision on allowing specific child processes (`diskutil`, `tmutil`).
7. **More agent app data**: Codex `sessions/` and `*.sqlite` are 25 GB here;
   `~/.claude/projects` transcripts; per-project `.turbo/cache`, `.nx/cache`,
   `.yarn/cache` when discovered through worktree or repo seeds.
8. **Windows and Linux worktree seeds** need a machine to verify
   `%USERPROFILE%\.codex\worktrees` and the XDG variants.
