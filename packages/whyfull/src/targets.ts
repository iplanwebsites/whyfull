/**
 * Known-target table. This file IS the product — the measuring code is generic,
 * but knowing that LM Studio hides 17 GB in ~/.lmstudio/models is the value.
 *
 * Each target declares:
 *   id       stable key
 *   label    what a human calls it
 *   paths    per-platform candidates; first that exists wins
 *   tier     safety tier, see TIERS below
 *   group    report section
 *   hint     the command that reclaims it, or why you should not
 *   depth    optional maxDepth, to keep huge trees cheap
 *
 * Tiers exist so the report can rank by (space x safety) instead of raw size.
 * A 60 GB Photos library and a 60 GB npm cache are not the same finding.
 */

import { homedir } from "node:os"
import type { Tier, TierMeta, Target, ResolvedTarget } from "./types"

const home = homedir()
const env = (name: string): string | null => process.env[name] || null

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
    note: "Safe to delete but slow to restore. Decide per item.",
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

/** Windows paths use forward slashes; node normalizes them fine. */
const LOCALAPPDATA = env("LOCALAPPDATA") || `${home}/AppData/Local`
const APPDATA = env("APPDATA") || `${home}/AppData/Roaming`

export const TARGETS: Target[] = [
  // ---------------------------------------------------------- AI models ----
  // The category that motivated this tool. On an ML machine these routinely
  // outweigh everything else combined, and no existing tool unifies them.
  {
    id: "huggingface",
    label: "HuggingFace hub cache",
    group: "AI models",
    tier: "JUDGEMENT",
    paths: {
      darwin: [env("HF_HOME"), `${home}/.cache/huggingface`],
      linux: [env("HF_HOME"), `${home}/.cache/huggingface`],
      // huggingface_hub defaults to %USERPROFILE%\.cache\huggingface on Windows,
      // so the .cache form is correct there — but it must be built from the
      // Windows home, not a hardcoded posix prefix.
      win32: [
        env("HF_HOME"),
        `${LOCALAPPDATA}/huggingface`,
        `${home}/.cache/huggingface`,
      ],
    },
    hint: "hf cache scan  (then: hf cache delete — revision-aware TUI)",
    childrenDir: "hub",
  },
  {
    id: "ollama",
    label: "Ollama models",
    group: "AI models",
    tier: "JUDGEMENT",
    paths: {
      darwin: [`${home}/.ollama/models`],
      linux: [`${home}/.ollama/models`, "/usr/share/ollama/.ollama/models"],
      win32: [`${home}/.ollama/models`],
    },
    hint: "ollama list  (then: ollama rm <model>)",
  },
  {
    id: "lmstudio",
    label: "LM Studio models",
    group: "AI models",
    tier: "JUDGEMENT",
    paths: {
      darwin: [`${home}/.lmstudio/models`, `${home}/.cache/lm-studio/models`],
      linux: [`${home}/.lmstudio/models`],
      win32: [`${home}/.lmstudio/models`],
    },
    hint: "Manage in LM Studio > My Models. No CLI.",
  },
  {
    id: "torch",
    label: "PyTorch hub cache",
    group: "AI models",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/.cache/torch`],
      linux: [env("TORCH_HOME"), `${home}/.cache/torch`],
      win32: [`${home}/.cache/torch`, `${LOCALAPPDATA}/torch`],
    },
    hint: "Re-downloaded on next load.",
  },
  {
    id: "whisper",
    label: "Whisper models",
    group: "AI models",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/.cache/whisper`],
      linux: [`${home}/.cache/whisper`],
      win32: [`${home}/.cache/whisper`],
    },
    hint: "Re-downloaded on next transcription.",
  },

  // ------------------------------------------------------ package stores ----
  {
    id: "npm",
    label: "npm cache",
    group: "Package managers",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/.npm`],
      linux: [`${home}/.npm`],
      win32: [`${LOCALAPPDATA}/npm-cache`, `${APPDATA}/npm-cache`],
    },
    hint: "npm cache clean --force",
    // ~500k tiny files. Capped so a routine report stays fast; --exact lifts it.
    budget: 120000,
  },
  {
    id: "pnpm",
    label: "pnpm store",
    group: "Package managers",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/Library/pnpm`, `${home}/.pnpm-store`],
      linux: [`${home}/.local/share/pnpm`, `${home}/.pnpm-store`],
      win32: [`${LOCALAPPDATA}/pnpm`],
    },
    hint: "pnpm store prune  (drops only unreferenced packages)",
    // ~630k hard-linked files, the slowest target on a typical dev machine.
    budget: 120000,
  },
  {
    id: "yarn",
    label: "Yarn cache",
    group: "Package managers",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/Library/Caches/Yarn`, `${home}/.yarn/berry/cache`],
      linux: [`${home}/.cache/yarn`, `${home}/.yarn/berry/cache`],
      win32: [`${LOCALAPPDATA}/Yarn`],
    },
    hint: "yarn cache clean",
  },
  {
    id: "pip",
    label: "pip cache",
    group: "Package managers",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/Library/Caches/pip`],
      linux: [`${home}/.cache/pip`],
      win32: [`${LOCALAPPDATA}/pip/Cache`],
    },
    hint: "pip cache purge",
  },
  {
    id: "uv",
    label: "uv cache",
    group: "Package managers",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/.cache/uv`],
      linux: [`${home}/.cache/uv`],
      win32: [`${LOCALAPPDATA}/uv/cache`],
    },
    hint: "uv cache clean",
  },
  {
    id: "conda",
    label: "conda packages",
    group: "Package managers",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/miniforge3/pkgs`, `${home}/anaconda3/pkgs`],
      linux: [`${home}/miniconda3/pkgs`, `${home}/anaconda3/pkgs`],
      win32: [`${home}/miniconda3/pkgs`],
    },
    hint: "conda clean --all",
  },
  {
    id: "cargo",
    label: "Cargo registry",
    group: "Package managers",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/.cargo/registry`],
      linux: [`${home}/.cargo/registry`],
      win32: [`${home}/.cargo/registry`],
    },
    hint: "cargo cache --autoclean  (needs cargo-cache)",
  },
  {
    id: "go",
    label: "Go module cache",
    group: "Package managers",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/go/pkg/mod`],
      linux: [`${home}/go/pkg/mod`],
      win32: [`${home}/go/pkg/mod`],
    },
    hint: "go clean -modcache",
  },
  {
    id: "gradle",
    label: "Gradle caches",
    group: "Package managers",
    tier: "REBUILD",
    paths: {
      darwin: [`${home}/.gradle/caches`],
      linux: [`${home}/.gradle/caches`],
      win32: [`${home}/.gradle/caches`],
    },
    hint: "Delete build-cache-* subdirs; keeps wrapper dists.",
  },
  {
    id: "homebrew",
    label: "Homebrew downloads",
    group: "Package managers",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/Library/Caches/Homebrew`],
      linux: [`${home}/.cache/Homebrew`],
      win32: [],
    },
    hint: "brew cleanup --prune=all",
  },

  // -------------------------------------------------------- build output ----
  {
    id: "xcode-derived",
    label: "Xcode DerivedData",
    group: "Build output",
    tier: "REBUILD",
    paths: {
      darwin: [`${home}/Library/Developer/Xcode/DerivedData`],
      linux: [],
      win32: [],
    },
    hint: "rm -rf ~/Library/Developer/Xcode/DerivedData/*",
  },
  {
    id: "xcode-devicesupport",
    label: "Xcode iOS DeviceSupport",
    group: "Build output",
    tier: "REBUILD",
    paths: {
      darwin: [`${home}/Library/Developer/Xcode/iOS DeviceSupport`],
      linux: [],
      win32: [],
    },
    hint: "Safe to delete; re-created when you next attach that device.",
  },
  {
    id: "coresimulator",
    label: "iOS Simulator devices",
    group: "Build output",
    tier: "REBUILD",
    paths: {
      darwin: [`${home}/Library/Developer/CoreSimulator`],
      linux: [],
      win32: [],
    },
    hint: "xcrun simctl delete unavailable",
  },
  {
    id: "playwright",
    label: "Playwright browsers",
    group: "Build output",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/Library/Caches/ms-playwright`],
      linux: [`${home}/.cache/ms-playwright`],
      win32: [`${LOCALAPPDATA}/ms-playwright`],
    },
    hint: "npx playwright uninstall --all",
  },
  {
    id: "puppeteer",
    label: "Puppeteer browsers",
    group: "Build output",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/.cache/puppeteer`],
      linux: [`${home}/.cache/puppeteer`],
      win32: [`${LOCALAPPDATA}/puppeteer`],
    },
    hint: "Re-downloaded on next install.",
  },
  {
    id: "electron",
    label: "Electron dists",
    group: "Build output",
    tier: "AUTO",
    paths: {
      darwin: [`${home}/Library/Caches/electron`],
      linux: [`${home}/.cache/electron`],
      win32: [`${LOCALAPPDATA}/electron/Cache`],
    },
    hint: "Re-downloaded on next build.",
  },

  // -------------------------------------------------------------- docker ----
  // The VM image is sparse, so `measure` reports allocated blocks — the honest
  // number. Pruning inside the VM does NOT shrink this file on macOS/Windows.
  {
    id: "docker",
    label: "Docker VM disk image",
    group: "Containers",
    tier: "JUDGEMENT",
    paths: {
      darwin: [`${home}/Library/Containers/com.docker.docker/Data`],
      linux: ["/var/lib/docker"],
      win32: [`${LOCALAPPDATA}/Docker/wsl`],
    },
    hint: "docker system df, then prune. Shrinking the image needs a Desktop reset.",
    depth: 3,
  },
  {
    id: "wsl",
    label: "WSL2 virtual disks",
    group: "Containers",
    tier: "DATA",
    paths: {
      darwin: [],
      linux: [],
      win32: [`${LOCALAPPDATA}/Packages`],
    },
    hint: "Often the top Windows offender. Compact with diskpart; holds a real filesystem.",
    depth: 4,
  },

  // ---------------------------------------------------------- app caches ----
  {
    id: "spotify",
    label: "Spotify cache",
    group: "App caches",
    tier: "APP",
    paths: {
      darwin: [`${home}/Library/Caches/com.spotify.client`],
      linux: [`${home}/.cache/spotify`],
      win32: [`${LOCALAPPDATA}/Spotify/Storage`],
    },
    hint: "Quit Spotify first. Offline downloads live here too.",
  },
  {
    id: "adobe-camera-raw",
    label: "Adobe Camera Raw cache",
    group: "App caches",
    tier: "APP",
    paths: {
      darwin: [`${home}/Library/Caches/Adobe Camera Raw 2`],
      linux: [],
      win32: [`${LOCALAPPDATA}/Adobe/CameraRaw/Cache`],
    },
    hint: "Previews, regenerated on demand.",
  },
  {
    id: "vscode",
    label: "VS Code support data",
    group: "App caches",
    tier: "APP",
    paths: {
      darwin: [`${home}/Library/Application Support/Code`],
      linux: [`${home}/.config/Code`],
      win32: [`${APPDATA}/Code`],
    },
    hint: "CachedData/ and Service Worker/ are safe; workspaceStorage holds state.",
    depth: 2,
  },

  // ------------------------------------------------------------ real data ---
  // Reported for context, explicitly flagged as not-cache.
  {
    id: "trash",
    label: "Trash",
    group: "User data",
    tier: "JUDGEMENT",
    paths: {
      darwin: [`${home}/.Trash`],
      linux: [`${home}/.local/share/Trash`],
      win32: [],
    },
    hint: "Empty it if you have reviewed the contents.",
  },
  {
    id: "ios-backups",
    label: "iOS device backups",
    group: "User data",
    tier: "DATA",
    paths: {
      darwin: [`${home}/Library/Application Support/MobileSync/Backup`],
      linux: [],
      win32: [`${APPDATA}/Apple Computer/MobileSync/Backup`],
    },
    hint: "Finder > Manage Backups. May be the only copy of a device.",
    depth: 2,
  },
  {
    id: "photos",
    label: "Photos library",
    group: "User data",
    tier: "DATA",
    paths: {
      darwin: [`${home}/Pictures/Photos Library.photoslibrary`],
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
    tier: "DATA",
    paths: {
      darwin: [`${home}/Library/Mail`],
      linux: [],
      win32: [],
    },
    hint: "Not a cache. TCC-protected: needs Full Disk Access to measure.",
    depth: 3,
  },
]

/** Targets applicable to this platform, with their first existing path. */
export function forPlatform(platform: NodeJS.Platform = process.platform): ResolvedTarget[] {
  return TARGETS.map((t) => ({
    ...t,
    candidates: t.paths[platform as keyof typeof t.paths] ?? [],
  })).filter((t) => t.candidates.filter(Boolean).length > 0)
}
