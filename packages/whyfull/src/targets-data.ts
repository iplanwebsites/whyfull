/**
 * Known-target database. PURE DATA — no runtime logic.
 *
 * This file IS the product: knowing that LM Studio hides 17 GB in
 * ~/.lmstudio/models is the value. The measuring code is generic.
 *
 * Each target declares:
 *   id       stable key, safe to match on
 *   label    human name
 *   paths    per-platform candidates; ~ is replaced with $HOME at runtime
 *   tier     safety tier: AUTO | REBUILD | JUDGEMENT | APP | DATA
 *   group    report section
 *   hint     the reclaim command, or why you should not
 *   depth    optional maxDepth, for huge trees
 *   budget   optional file-count budget before estimating
 *
 * Users can add their own in ~/.config/whyfull/targets.json — same schema.
 * Found a common hog we don't track? Open an issue:
 * https://github.com/iplanwebsites/whyfull/issues/new
 */

import type { Tier, TierMeta } from "./types"

/** Tier definitions — ranked by deletion risk. */
export const TIERS: Record<Tier, TierMeta> = {
  AUTO: {
    rank: 1,
    label: "regenerates automatically",
    note: "Safe. Rebuilt on next use, costs a re-download.",
  },
  REBUILD: {
    rank: 2,
    label: "rebuildable",
    note: "Safe. Costs CPU time to regenerate, no data lost.",
  },
  JUDGEMENT: {
    rank: 3,
    label: "judgement call",
    note: "Removable, but potentially expensive or slow to restore. Decide per item.",
  },
  APP: {
    rank: 4,
    label: "app-managed",
    note: "Quit the app first or it rewrites the cache immediately.",
  },
  DATA: {
    rank: 5,
    label: "real data — do not bulk-delete",
    note: "May be the only copy. Prune from inside the app, after a backup.",
  },
}

/**
 * Raw target definitions. Paths use ~ for home (resolved at runtime).
 * This is a plain object array — no imports, no functions, pure data.
 */
export const TARGETS_RAW = [
  // ---------------------------------------------------------- AI models ----
  {
    id: "huggingface",
    label: "HuggingFace hub cache",
    group: "AI models",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["$HF_HOME", "~/.cache/huggingface"],
      linux: ["$HF_HOME", "~/.cache/huggingface"],
      win32: ["$HF_HOME", "$LOCALAPPDATA/huggingface", "~/.cache/huggingface"],
    },
    hint: "hf cache scan  (then: hf cache delete — revision-aware TUI)",
    childrenDir: "hub",
  },
  {
    id: "ollama",
    label: "Ollama models",
    group: "AI models",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["~/.ollama/models"],
      linux: ["~/.ollama/models", "/usr/share/ollama/.ollama/models"],
      win32: ["~/.ollama/models"],
    },
    hint: "ollama list  (then: ollama rm <model>)",
  },
  {
    id: "lmstudio",
    label: "LM Studio models",
    group: "AI models",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["~/.lmstudio/models", "~/.cache/lm-studio/models"],
      linux: ["~/.lmstudio/models"],
      win32: ["~/.lmstudio/models"],
    },
    hint: "Manage in LM Studio > My Models. No CLI.",
  },
  {
    id: "torch",
    label: "PyTorch hub cache",
    group: "AI models",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/.cache/torch"],
      linux: ["$TORCH_HOME", "~/.cache/torch"],
      win32: ["~/.cache/torch", "$LOCALAPPDATA/torch"],
    },
    hint: "Re-downloaded on next load.",
  },
  {
    id: "whisper",
    label: "Whisper models",
    group: "AI models",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/.cache/whisper"],
      linux: ["~/.cache/whisper"],
      win32: ["~/.cache/whisper"],
    },
    hint: "Re-downloaded on next transcription.",
  },

  // ------------------------------------------------------ package stores ----
  {
    id: "npm",
    label: "npm cache",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/.npm"],
      linux: ["~/.npm"],
      win32: ["$LOCALAPPDATA/npm-cache", "$APPDATA/npm-cache"],
    },
    hint: "npm cache clean --force",
    budget: 120000,
  },
  {
    id: "pnpm-store",
    label: "pnpm content-addressable store",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: [
        "$PNPM_HOME/store",
        "$XDG_DATA_HOME/pnpm/store",
        "~/Library/pnpm/store",
      ],
      linux: [
        "$PNPM_HOME/store",
        "$XDG_DATA_HOME/pnpm/store",
        "~/.local/share/pnpm/store",
      ],
      win32: ["$PNPM_HOME/store", "$LOCALAPPDATA/pnpm/store"],
    },
    hint: "pnpm store prune drops only unreferenced packages; inspect and move obsolete v* format folders to Trash only after confirming no project uses them",
    budget: 120000,
  },
  {
    id: "pnpm-store-volume",
    label: "pnpm per-volume fallback store",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/.pnpm-store"],
      linux: ["~/.pnpm-store"],
      win32: [],
    },
    hint: "pnpm store prune; inspect and move obsolete v* format folders to Trash only after confirming no project uses them",
    budget: 120000,
  },
  {
    id: "pnpm-cache",
    label: "pnpm metadata + dlx cache",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["$XDG_CACHE_HOME/pnpm", "~/Library/Caches/pnpm"],
      linux: ["$XDG_CACHE_HOME/pnpm", "~/.cache/pnpm"],
      win32: ["$LOCALAPPDATA/pnpm-cache"],
    },
    hint: "pnpm cache delete  (dlx/ also expires on its own)",
  },
  {
    id: "pnpm-nodejs",
    label: "pnpm-managed Node runtimes",
    group: "Package managers",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["$PNPM_HOME/nodejs", "~/Library/pnpm/nodejs"],
      linux: ["$PNPM_HOME/nodejs", "~/.local/share/pnpm/nodejs"],
      win32: ["$PNPM_HOME/nodejs", "$LOCALAPPDATA/pnpm/nodejs"],
    },
    hint: "pnpm env list / pnpm env remove <ver>  (pnpm 11: pnpm runtime)",
  },
  {
    id: "pnpm-tools",
    label: "pnpm self-managed binaries",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["$PNPM_HOME/.tools", "~/Library/pnpm/.tools"],
      linux: ["$PNPM_HOME/.tools", "~/.local/share/pnpm/.tools"],
      win32: ["$PNPM_HOME/.tools", "$LOCALAPPDATA/pnpm/.tools"],
    },
    hint: "Inspect versions not pinned by a packageManager field; move unused ones to Trash. pnpm re-downloads them.",
  },
  {
    id: "pnpm-pm-store",
    label: "pnpm package-manager-store",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: [
        "$PNPM_HOME/package-manager-store",
        "~/Library/pnpm/package-manager-store",
      ],
      linux: [
        "$PNPM_HOME/package-manager-store",
        "~/.local/share/pnpm/package-manager-store",
      ],
      win32: [
        "$PNPM_HOME/package-manager-store",
        "$LOCALAPPDATA/pnpm/package-manager-store",
      ],
    },
    hint: "Inspect versions not pinned by a packageManager field; move unused ones to Trash. pnpm re-downloads them.",
  },
  {
    id: "pnpm-global",
    label: "pnpm global installs",
    group: "Package managers",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["$PNPM_HOME/global", "~/Library/pnpm/global"],
      linux: ["$PNPM_HOME/global", "~/.local/share/pnpm/global"],
      win32: ["$PNPM_HOME/global", "$LOCALAPPDATA/pnpm/global"],
    },
    hint: "pnpm ls -g, then pnpm rm -g <pkg>",
  },
  {
    id: "yarn",
    label: "Yarn cache",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/Library/Caches/Yarn", "~/.yarn/berry/cache"],
      linux: ["~/.cache/yarn", "~/.yarn/berry/cache"],
      win32: ["$LOCALAPPDATA/Yarn"],
    },
    hint: "yarn cache clean  (Yarn Berry default is enableGlobalCache: false — the bulk is usually project-local .yarn/cache)",
  },
  {
    id: "bun-cache",
    label: "Bun install cache",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/.bun/install/cache"],
      linux: ["~/.bun/install/cache"],
      win32: [],
    },
    hint: "Re-downloaded on next install.",
  },
  {
    id: "bun-global",
    label: "Bun global installs",
    group: "Package managers",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["~/.bun/install/global"],
      linux: ["~/.bun/install/global"],
      win32: [],
    },
    hint: "bun pm ls -g, then bun remove -g <pkg>",
  },
  {
    id: "deno-cache",
    label: "Deno cache",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["$DENO_DIR", "~/Library/Caches/deno"],
      linux: ["$DENO_DIR", "~/.cache/deno"],
      win32: ["$DENO_DIR", "$LOCALAPPDATA/deno"],
    },
    hint: "deno clean",
  },
  {
    id: "corepack-cache",
    label: "Corepack cache",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["$COREPACK_HOME", "~/.cache/node/corepack"],
      linux: ["$COREPACK_HOME", "~/.cache/node/corepack"],
      win32: ["$COREPACK_HOME", "$LOCALAPPDATA/node/corepack"],
    },
    hint: "corepack cache clean",
  },
  {
    id: "nvm-versions",
    label: "nvm Node versions",
    group: "Package managers",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["$NVM_DIR/versions/node", "~/.nvm/versions/node"],
      linux: ["$NVM_DIR/versions/node", "~/.nvm/versions/node"],
      win32: [],
    },
    hint: "nvm ls, then nvm uninstall <ver>",
  },
  {
    id: "volta-home",
    label: "Volta toolchains",
    group: "Package managers",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["$VOLTA_HOME", "~/.volta"],
      linux: ["$VOLTA_HOME", "~/.volta"],
      win32: ["$VOLTA_HOME"],
    },
    hint: "volta list, then volta uninstall <tool>",
  },
  {
    id: "fnm-versions",
    label: "fnm Node versions",
    group: "Package managers",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["$FNM_DIR", "~/Library/Application Support/fnm"],
      linux: ["$FNM_DIR", "~/.local/share/fnm"],
      win32: ["$FNM_DIR", "$APPDATA/fnm"],
    },
    hint: "fnm list, then fnm uninstall <ver>",
  },
  {
    id: "pip",
    label: "pip cache",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/Library/Caches/pip"],
      linux: ["~/.cache/pip"],
      win32: ["$LOCALAPPDATA/pip/Cache"],
    },
    hint: "pip cache purge",
  },
  {
    id: "uv",
    label: "uv cache",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/.cache/uv"],
      linux: ["~/.cache/uv"],
      win32: ["$LOCALAPPDATA/uv/cache"],
    },
    hint: "uv cache clean",
  },
  {
    id: "conda",
    label: "conda packages",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/miniforge3/pkgs", "~/anaconda3/pkgs"],
      linux: ["~/miniconda3/pkgs", "~/anaconda3/pkgs"],
      win32: ["~/miniconda3/pkgs"],
    },
    hint: "conda clean --all",
  },
  {
    id: "cargo",
    label: "Cargo registry",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/.cargo/registry"],
      linux: ["~/.cargo/registry"],
      win32: ["~/.cargo/registry"],
    },
    hint: "cargo cache --autoclean  (needs cargo-cache)",
  },
  {
    id: "go",
    label: "Go module cache",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/go/pkg/mod"],
      linux: ["~/go/pkg/mod"],
      win32: ["~/go/pkg/mod"],
    },
    hint: "go clean -modcache",
  },
  {
    id: "gradle",
    label: "Gradle caches",
    group: "Package managers",
    tier: "REBUILD" as Tier,
    paths: {
      darwin: ["~/.gradle/caches"],
      linux: ["~/.gradle/caches"],
      win32: ["~/.gradle/caches"],
    },
    hint: "Move build-cache-* subdirs to Trash; keep wrapper distributions.",
  },
  {
    id: "homebrew",
    label: "Homebrew downloads",
    group: "Package managers",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/Library/Caches/Homebrew"],
      linux: ["~/.cache/Homebrew"],
      win32: [],
    },
    hint: "brew cleanup --prune=all",
  },

  // -------------------------------------------------------- build output ----
  {
    id: "xcode-derived",
    label: "Xcode DerivedData",
    group: "Build output",
    tier: "REBUILD" as Tier,
    paths: {
      darwin: ["~/Library/Developer/Xcode/DerivedData"],
      linux: [],
      win32: [],
    },
    hint: "Quit Xcode, then remove Derived Data from Xcode Settings > Locations; it rebuilds on demand.",
  },
  {
    id: "xcode-devicesupport",
    label: "Xcode iOS DeviceSupport",
    group: "Build output",
    tier: "REBUILD" as Tier,
    paths: {
      darwin: ["~/Library/Developer/Xcode/iOS DeviceSupport"],
      linux: [],
      win32: [],
    },
    hint: "Quit Xcode and inspect old OS-version folders; move confirmed-unused folders to Trash. They are recreated when needed.",
  },
  {
    id: "coresimulator",
    label: "iOS Simulator devices",
    group: "Build output",
    tier: "REBUILD" as Tier,
    paths: {
      darwin: ["~/Library/Developer/CoreSimulator"],
      linux: [],
      win32: [],
    },
    hint: "Preview with xcrun simctl list devices; then use xcrun simctl delete unavailable for devices whose runtimes are gone.",
  },
  {
    id: "coresimulator-runtimes",
    label: "iOS Simulator runtimes (system-wide)",
    group: "Build output",
    tier: "REBUILD" as Tier,
    paths: {
      darwin: ["/Library/Developer/CoreSimulator"],
      linux: [],
      win32: [],
    },
    hint: "Manage in Xcode > Settings > Components. CLI: xcrun simctl runtime list; always dry-run runtime delete first. If an asset is unregistered, use runtime scan-and-mount—never edit AssetsV2 manually.",
  },
  {
    id: "playwright",
    label: "Playwright browsers",
    group: "Build output",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/Library/Caches/ms-playwright"],
      linux: ["~/.cache/ms-playwright"],
      win32: ["$LOCALAPPDATA/ms-playwright"],
    },
    hint: "npx playwright uninstall --all",
  },
  {
    id: "puppeteer",
    label: "Puppeteer browsers",
    group: "Build output",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/.cache/puppeteer"],
      linux: ["~/.cache/puppeteer"],
      win32: ["$LOCALAPPDATA/puppeteer"],
    },
    hint: "Re-downloaded on next install.",
  },
  {
    id: "electron",
    label: "Electron dists",
    group: "Build output",
    tier: "AUTO" as Tier,
    paths: {
      darwin: ["~/Library/Caches/electron"],
      linux: ["~/.cache/electron"],
      win32: ["$LOCALAPPDATA/electron/Cache"],
    },
    hint: "Re-downloaded on next build.",
  },

  // -------------------------------------------------------------- docker ----
  {
    id: "docker",
    label: "Docker VM disk image",
    group: "Containers",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["~/Library/Containers/com.docker.docker/Data"],
      linux: ["/var/lib/docker"],
      win32: ["$LOCALAPPDATA/Docker/wsl"],
    },
    hint: "Allocated VM bytes are included. Start Docker Desktop, run docker system df, then prune; shrinking the image may need a Desktop reset.",
    depth: 5,
  },
  {
    id: "wsl",
    label: "WSL2 virtual disks",
    group: "Containers",
    tier: "DATA" as Tier,
    paths: {
      darwin: [],
      linux: [],
      win32: ["$LOCALAPPDATA/Packages"],
    },
    hint: "Often the top Windows offender. Compact with diskpart; holds a real filesystem.",
    depth: 4,
  },

  // ---------------------------------------------------------- app caches ----
  {
    id: "spotify",
    label: "Spotify cache",
    group: "App caches",
    tier: "APP" as Tier,
    paths: {
      darwin: ["~/Library/Caches/com.spotify.client"],
      linux: ["~/.cache/spotify"],
      win32: ["$LOCALAPPDATA/Spotify/Storage"],
    },
    hint: "Quit Spotify first. Offline downloads live here too.",
  },
  {
    id: "adobe-camera-raw",
    label: "Adobe Camera Raw cache",
    group: "App caches",
    tier: "APP" as Tier,
    paths: {
      darwin: ["~/Library/Caches/Adobe Camera Raw 2"],
      linux: [],
      win32: ["$LOCALAPPDATA/Adobe/CameraRaw/Cache"],
    },
    hint: "Previews, regenerated on demand.",
  },
  {
    id: "vscode",
    label: "VS Code support data",
    group: "App caches",
    tier: "APP" as Tier,
    paths: {
      darwin: ["~/Library/Application Support/Code"],
      linux: ["~/.config/Code"],
      win32: ["$APPDATA/Code"],
    },
    hint: "CachedData/ and Service Worker/ are safe; workspaceStorage holds state.",
    depth: 2,
  },
  {
    id: "claude-desktop",
    label: "Claude desktop app",
    group: "App caches",
    tier: "APP" as Tier,
    paths: {
      darwin: ["~/Library/Application Support/Claude"],
      linux: ["~/.config/Claude"],
      win32: ["$APPDATA/Claude"],
    },
    hint: "vm_bundles/ is large; claude-code/ can be cleared via /doctor or manually.",
    depth: 2,
  },
  {
    id: "chrome",
    label: "Google Chrome",
    group: "App caches",
    tier: "APP" as Tier,
    paths: {
      darwin: ["~/Library/Application Support/Google/Chrome"],
      linux: ["~/.config/google-chrome"],
      win32: ["$LOCALAPPDATA/Google/Chrome/User Data"],
    },
    hint: "Settings > Privacy > Clear browsing data. Profile data is mixed in.",
    depth: 2,
  },

  // ---------------------------------------------------- AI coding agents ----
  {
    id: "codex-home",
    label: "Codex home",
    group: "AI coding agents",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["$CODEX_HOME", "~/.codex"],
      linux: ["$CODEX_HOME", "~/.codex"],
      win32: ["$CODEX_HOME", "~/.codex"],
    },
    hint: "worktrees/ via whyfull --worktrees; sessions/ and root *.sqlite files are conversation/history data — inspect before pruning",
    budget: 120000,
  },
  {
    id: "claude-code-home",
    label: "Claude Code home",
    group: "AI coding agents",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["~/.claude"],
      linux: ["~/.claude"],
      win32: ["~/.claude"],
    },
    hint: "projects/ holds per-repo transcripts; cleanupPeriodDays in settings controls retention",
    budget: 120000,
  },
  {
    id: "cursor-home",
    label: "Cursor home",
    group: "AI coding agents",
    tier: "APP" as Tier,
    paths: {
      darwin: ["~/.cursor"],
      linux: ["~/.cursor"],
      win32: ["~/.cursor"],
    },
    hint: "Quit Cursor first; manage via the app.",
  },
  {
    id: "vibe-kanban",
    label: "Vibe Kanban data",
    group: "AI coding agents",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["~/.vibe-kanban"],
      linux: ["~/.vibe-kanban"],
      win32: ["~/.vibe-kanban"],
    },
    hint: "repos/ and workspaces/ are clones + worktrees; prune from the app",
  },
  {
    id: "gemini-home",
    label: "Gemini CLI home",
    group: "AI coding agents",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["~/.gemini"],
      linux: ["~/.gemini"],
      win32: ["~/.gemini"],
    },
    hint: "Session and cache data; prune by age.",
  },
  {
    id: "windsurf-worktrees",
    label: "Windsurf worktrees",
    group: "AI coding agents",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["~/.windsurf/worktrees"],
      linux: ["~/.windsurf/worktrees"],
      win32: ["~/.windsurf/worktrees"],
    },
    hint: "LRU-capped at 20 per workspace; inspect stale checkouts, move them to Trash, then run git worktree prune",
  },
  {
    id: "conductor-workspaces",
    label: "Conductor workspaces",
    group: "AI coding agents",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["~/conductor/workspaces"],
      linux: [],
      win32: [],
    },
    hint: "One checkout per workspace; inspect finished ones and move them to the OS Trash/Recycle Bin.",
  },

  // ------------------------------------------------------------ real data ---
  {
    id: "trash",
    label: "Trash",
    group: "User data",
    tier: "JUDGEMENT" as Tier,
    paths: {
      darwin: ["~/.Trash"],
      linux: ["~/.local/share/Trash"],
      win32: [],
    },
    hint: "Empty it if you have reviewed the contents.",
  },
  {
    id: "ios-backups",
    label: "iOS device backups",
    group: "User data",
    tier: "DATA" as Tier,
    paths: {
      darwin: ["~/Library/Application Support/MobileSync/Backup"],
      linux: [],
      win32: ["$APPDATA/Apple Computer/MobileSync/Backup"],
    },
    hint: "Finder > Manage Backups. May be the only copy of a device.",
    depth: 2,
  },
  {
    id: "photos",
    label: "Photos library",
    group: "User data",
    tier: "DATA" as Tier,
    paths: {
      darwin: ["~/Pictures/Photos Library.photoslibrary"],
      linux: [],
      win32: [],
    },
    hint: "Not a cache. Prune inside Photos, never on disk.",
    depth: 2,
  },
  {
    id: "mail",
    label: "Mail storage",
    group: "User data",
    tier: "DATA" as Tier,
    paths: {
      darwin: ["~/Library/Mail"],
      linux: [],
      win32: [],
    },
    hint: "Not a cache. TCC-protected: needs Full Disk Access to measure.",
    depth: 3,
  },
] as const
