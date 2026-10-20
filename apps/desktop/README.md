# Whyfull desktop

Tauri 2 wraps the existing local disk explorer. Reports, scanning, policies,
worker threads, and diagnostic subprocesses use the same Node engine as npm.
Node is bundled; the installed app needs neither Node nor npm. Nothing is
uploaded while scanning. The signed release app checks GitHub for updates on
launch and when you choose **Whyfull → Check for updates…**.

## Build and run

Prerequisites: Node 22.23.2, pnpm 9.12, Rust stable (at least 1.90), and the
[Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/).
Build natively for the platform/architecture being distributed. The preparation
script copies the running Node executable; cross-compiling only Rust would
package a mismatched runtime.

```sh
pnpm install
pnpm desktop:dev
pnpm desktop:build
pnpm cli:archive
```

`desktop:dev` rebuilds the shared viewer/engine before starting Tauri. It does
not hot-reload the viewer. After engine or UI changes, restart the command.
`desktop:build` creates local unsigned installers. On macOS it packages the app
into a standard DMG with an Applications shortcut using `hdiutil`, avoiding
Finder Automation permissions. Release CI uses Tauri’s standard DMG packaging. It packages the existing UI,
not a separate desktop frontend. Build output lives under
`apps/desktop/src-tauri/target/release/bundle/`. Portable CLI archives are in
`apps/desktop/dist/`.

```sh
pnpm desktop:prepare
pnpm --filter @whyfull/desktop test:runtime
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
```

The integration tests run the actual copied Node runtime, CLI, packaged workers,
and authenticated viewer, and verify cleanup when the parent pipe closes.
`desktop-check.yml` builds on macOS, Linux, and Windows and smoke-tests the
native `--cli` entry without opening a webview. These remote jobs must pass
before claiming support has been verified on those platforms.

## Install the desktop command

Move Whyfull to its permanent location first (on macOS, `/Applications`). Open
it, then choose **Whyfull → Install command-line tool…**. This writes a launcher
in `~/.local/bin/whyfull` on macOS/Linux, or
`%USERPROFILE%\AppData\Local\Whyfull\bin\whyfull.cmd` on Windows. Add that
directory to PATH if it is not there already. No administrator access or shell
profile changes are required by the installer. It refuses to replace existing
commands or symlinks; existing Whyfull-owned launchers can be refreshed.

```sh
whyfull                         # original terminal report
whyfull --json                   # JSON report
whyfull --scan --root . --json  # filesystem inventory
whyfull ui                       # existing browser-based viewer
```

The launcher invokes the installed application with `--cli`; that branch runs
before Tauri's event loop and single-instance handling. CLI reports work while
the desktop is open and without a graphical session (the desktop executable
still needs its OS libraries). CLI arguments, working directory, stdio, and
exit codes pass to the engine. On Linux AppImage installations the launcher
references the persistent AppImage path, not a temporary mount.

The command follows the installed app when it updates. Checks happen in the
GUI; running a report does not contact an update service. npm installations
retain npm ownership and update with `npm install -g whyfull@latest` or
`npx whyfull@latest`. A portable CLI archive updates by replacing the directory.
Use `command -v whyfull` (Windows: `where whyfull`) to check which installation
wins PATH precedence. Moving or deleting the desktop app invalidates its
launcher; reinstall it from the app after moving. Remove the launcher to
uninstall the command. No PATH mutation or package-manager takeover occurs.

## Release setup

All channels use `packages/whyfull/package.json` as the version source. A
build-time config overlay applies it to Tauri. Tag `v<version>` to build a
**draft** GitHub release with macOS ARM64/Intel DMGs, Linux x64 AppImage/deb,
Windows x64 NSIS installers, and standalone CLI archives with SHA-256 checksums.
The workflow uses native runners so the Node sidecar matches each installer.
A manual workflow run also creates a draft for the current package version.
It creates one draft before the build matrix starts, then validates every
installer, standalone archive, and stable updater platform before uploading
`downloads.json` and `SHA256SUMS.txt`. The public download page consumes that
metadata; publishing an incomplete draft cannot advertise working downloads.

### Preview releases

Use a distinct prerelease version such as `0.0.3-preview.1` in the engine's
package manifest and tag it `v0.0.3-preview.1`. Preview tags automatically create
a GitHub prerelease draft. By default they use macOS ad-hoc signing (no Apple
Developer ID/notarization), need no Apple or updater secrets, and omit automatic
updates. The download page labels them **Unsigned preview** and shows the
first-launch instructions. Do not reuse a preview version/tag for stable.

Manual dispatch accepts `channel` and `macos_signing`. `auto` infers the channel
from the package version and uses notarized signing for stable, unsigned for
preview. A preview can opt into notarization once Apple credentials exist;
it still does not follow the stable update feed. Stable versions cannot opt
out of notarization. The workflow refuses to mutate a published release.

Before running `.github/workflows/desktop-release.yml`, configure:

| Setting                                       | GitHub location     | Purpose                                                |
| --------------------------------------------- | ------------------- | ------------------------------------------------------ |
| `WHYFULL_UPDATER_PUBLIC_KEY`                  | Repository variable | Public key embedded into release builds                |
| `TAURI_SIGNING_PRIVATE_KEY`                   | Secret              | Signs every updater artifact                           |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`          | Secret              | Optional updater key password                          |
| `APPLE_CERTIFICATE`                           | Secret              | Base64 Developer ID Application `.p12`                 |
| `APPLE_CERTIFICATE_PASSWORD`                  | Secret              | Certificate password                                   |
| `APPLE_SIGNING_IDENTITY`                      | Secret              | Developer ID Application signing identity              |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Secrets             | Apple ID, app-specific password, team for notarization |

Generate an updater key once on a trusted machine:

```sh
pnpm --filter @whyfull/desktop tauri signer generate -w /secure/path/whyfull.key
```

Keep the private key backed up outside the repository. Set the public key to
the **contents** of the generated `.pub` file. The release workflow fails early
without updater credentials; macOS also requires signing/notarization secrets.
Local builds omit the updater rather than embedding a dummy trust key.

Unsigned preview builds do not require these secrets. For production, keep
updater and Apple signing credentials separate: updater signatures protect
replacement payloads, while Developer ID/notarization establish macOS trust.

Tauri signs the Node **external binary** with the application. The Node runtime
is outside desktop resources specifically so it participates in signing.
The supplied macOS entitlements allow Node/V8 JIT execution after signing.
Node's license, engine dependency notices, and viewer dependency notices ship
with both the desktop and CLI archive.

Windows installers have cryptographically signed updater payloads, but Windows
Authenticode is a separate setup. Configure Tauri's `bundle.windows` signing
options or a `signCommand` backed by your certificate provider before public
Windows distribution. The workflow does not invent a certificate or bypass
SmartScreen. Linux deb installations should update through their package
manager; the Tauri updater is intended for the AppImage channel.

After reviewing all assets and checking a signed install/update on each OS,
publish the draft. `tauri-action` merges the platform entries into `latest.json`;
it becomes reachable at
`https://github.com/iplanwebsites/whyfull/releases/latest/download/latest.json`
only when the release is public. Installation prompts before stopping the scan,
verifies the update signature, replaces the full app including its engine,
and restarts it. Failed checks stay quiet on startup and show errors when
requested manually. This updater cannot be exercised end to end until a signed
release and a newer signed release are published.

## Release process

The initial public release should be a preview. Move to stable after testing
downloaded installers on every supported OS and exercising an update from a
previous signed build. Windows Authenticode setup is still outstanding; the
metadata and release notes explicitly identify the Windows installer as unsigned.
Do not claim it is signed until the certificate provider and verification are
configured, and the metadata generator is updated to record that evidence.

1. Set `packages/whyfull/package.json` to the intended version, update the docs,
   and commit/merge the changes. All desktop and portable builds derive their
   version from this package; preview versions contain a prerelease suffix.
2. Push `v<version>` (or manually dispatch the release workflow). It creates a
   draft, runs native runtime/CLI checks, builds all platforms, and attaches
   release metadata only after the complete matrix succeeds. macOS notarized
   builds additionally run `codesign --verify` and `spctl --assess`.
3. Download the actual installers and archives from the draft. Verify first
   launch, a report against a small fixture, CLI installation/arguments, and
   uninstall on macOS Apple Silicon/Intel, Windows x64, and Linux x64. Check the
   unsigned-preview instructions where applicable. For stable, verify desktop
   updates and the installed CLI after an update. Review `SHA256SUMS.txt` and
   the channel/signing values in `downloads.json`.
4. Replace the release-note template's final maintainer paragraph with the
   changes for this version. Publish the draft once the checks pass. The site
   reads only public releases with complete validated metadata and refreshes
   within five minutes. Stable downloads take precedence over newer previews.
5. Publish the matching npm version separately if desired. A preview belongs
   under npm's `next` tag (`--tag next`), keeping `latest` for stable versions.
   npm credentials and publish timing do not control desktop downloads.

The landing page links to `/download/`, where desktop installation is primary
and the CLI is prominent. The app-owned CLI follows desktop updates; standalone
archives update by replacement; npm owns its own updates. Homebrew and WinGet
are follow-up distribution channels once the installers and release cadence
are dependable. Do not advertise commands for packages that aren't published.

Publish stable npm separately with the existing package build/prepack workflow:

```sh
pnpm build
pnpm --filter whyfull publish --access public
```

npm authentication/provenance is managed by the npm account or trusted publishing
configuration. A draft desktop release does not publish an npm package.
Publishing to npm does not require another GitHub release. Keep GitHub's
**Latest** release pointing to a complete stable desktop release: the desktop
updater reads its `latest.json`. Do not mark npm-only or preview releases Latest.

## Architecture and tradeoffs

The Rust shell starts `whyfull-node` with `runtime/desktop.mjs` over private
stdin/stdout pipes. The child returns its ephemeral loopback URL with a fresh
bearer token. The webview loads that exact server origin; navigation to other
origins is blocked, and **no Tauri IPC capability is granted to remote content**.
Native menus own update and CLI installation controls. API authentication,
origin checks, import validation, and demo-first cleanup remain in the existing
engine. Desktop cleanup stays in demo mode; users who explicitly want native
Trash capability can use the CLI's existing `--allow-trash` option.

Closing the parent stdin pipe stops the server and scanner even if Rust crashes.
Normal exit also waits for cleanup and kills an unresponsive engine after two
seconds. Updater installation stops the engine before replacing its files.
Single-instance handling focuses the existing desktop window; independent CLI
reports bypass it.

Bundling Node adds roughly the size of Node to the application. This is the
reliable first release because the current engine relies on Node worker threads,
filesystem APIs, `import.meta.url` asset paths, and subprocess diagnostics. The
separate scriptc experiment remains independent and is not a release dependency.
A future Rust engine can replace the sidecar behind the same viewer API after
it reaches feature parity.

Do not put every platform's desktop binary into the existing npm package.
Keep npm small and useful in scripts/CI. If a no-Node single executable becomes
necessary later, publish platform packages through `optionalDependencies` with
a small npm dispatcher; validate worker and asset behavior before replacing
this runtime-based build. There is no postinstall download or self-modification
of npm-managed files in this implementation.

Primary references: [Node sidecars](https://v2.tauri.app/learn/sidecar-nodejs/),
[Tauri updater](https://v2.tauri.app/plugin/updater/),
[macOS signing](https://v2.tauri.app/distribute/sign/macos/), and
[GitHub release action](https://github.com/tauri-apps/tauri-action).
