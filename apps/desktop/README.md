# Whyfull desktop

Tauri 2 wraps the existing local disk explorer. Reports, scanning, policies,
worker threads, and diagnostic subprocesses use the same Node engine as npm.
Node is bundled; the installed app needs neither Node nor npm. Nothing is
uploaded while scanning. The signed release app checks GitHub for updates on
launch and when you choose **Whyfull → Check for updates…**.

The location menu offers **Use Rust scanner · Experimental**, off by default.
The choice applies to new scans; Node remains available. macOS/Linux preparation
builds and packages the optional crawler. The desktop launches its signed Tauri
external binary; the portable CLI carries a platform-matched copy under
`engine/native`. `app-engine` is the JS-only resource copy used by Tauri, so a
second unsigned helper is not embedded in the app's Resources directory.

## License and trial

The desktop app is a paid product with an honor-system trial: free for 30 days
of use (days the app is opened), then **$19 one-time** per person for all of
their computers, updates included. After the trial the app keeps working and
shows a reminder at most once a day after a scan; the EULA still requires a
license for continued use. **Support Whyfull** in the app accepts a key or the
purchase-email link, and links to buying (`/buy/`), key recovery (`/recover/`)
and the terms (`/legal/`) on whyfull.app. Keys are verified offline; the app
sends nothing anywhere. The bundled CLI (`whyfull --cli` and the installed
launcher) is free and never checks a license. See
[`docs/viewer.md`](../../docs/viewer.md#desktop-license) for the mechanics.

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
Finder Automation permissions. Release CI uses the same Finder-free DMG
packaging after Tauri signs and notarizes the app; it signs, notarizes and
staples the DMG container too. It packages the existing UI,
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
whyfull                         # Interactive picker. Start here.
whyfull --tui                   # Terminal summary with cleanup guidance.
whyfull --json                  # Report for your coding agent.
whyfull --ui                    # Visual explorer in your browser.
whyfull --scan --root . --json  # filesystem inventory
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

Desktop installers and standalone CLI archives use `apps/desktop/package.json`
as their release version. The bundled engine keeps its independent npm version
from `packages/whyfull/package.json`. A build-time config overlay applies the
desktop version to Tauri. Tag `v<desktop-version>` to build a
**draft** GitHub release for the platforms listed in `release-platforms.json`
(today macOS ARM64/Intel DMGs and their CLI archives; Windows x64 NSIS and Linux
x64 AppImage/deb join later), with SHA-256 checksums. A stable platform can join
but never leave; the workflow checks the previous stable `latest.json`.
The workflow uses native runners so the Node sidecar matches each installer.
A manual run defaults to `mode: build-only`: every platform builds and its files
are kept as workflow artifacts, and no GitHub release is created or changed.
Choose `mode: draft-release` to build a draft for the current package version.
Each platform job only uploads workflow artifacts. A final job then assembles
`latest.json`, validates every installer, standalone archive, and stable updater
platform, and only then creates the draft and attaches the files, `downloads.json`
and `SHA256SUMS.txt`. A failing platform leaves no draft changes. The public
download page consumes that metadata; publishing an incomplete draft cannot
advertise working downloads. See [`docs/desktop-builds.md`](../../docs/desktop-builds.md)
for the per-platform strategy, dry runs, and the secret setup checklist.

### Preview releases

Use a distinct prerelease version such as `0.0.2-preview.1` in the desktop
package manifest and tag it `v0.0.2-preview.1`. Preview tags automatically create
a GitHub prerelease draft. By default they use macOS ad-hoc signing (no Apple
Developer ID/notarization), need no Apple or updater secrets, and omit automatic
updates. The download page labels them **Unsigned preview** and shows the
first-launch instructions. Do not reuse a preview version/tag for stable.

Manual dispatch accepts `mode`, `channel`, `macos_signing`, and `updater`.
`auto` infers the channel from the package version and uses notarized signing
for stable, unsigned for preview. A preview can opt into notarization once Apple
credentials exist; it still does not follow the stable update feed. Stable
draft releases cannot opt out of notarization or signed updates; only a
`build-only` run may use `macos_signing: unsigned` and `updater: off`, which
needs no secrets. The workflow refuses to mutate a published release.

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
For a local signed build, load the owner-only private key file into
`TAURI_SIGNING_PRIVATE_KEY` for the build process. `WHYFULL_UPDATER_PUBLIC_KEY`
contains the matching public key. Keep both file paths outside the checkout.

Never commit signing keys, certificate exports, keychains, provisioning profiles,
or credential files. Supply private values through GitHub Secrets or the local
build environment. Run `node scripts/check-signing-material.mjs` from the repo
root to check staged files before committing; CI runs the same check. It checks
credential filenames and private-key markers, not every possible secret format.
The npm prepack check also inspects the actual publish list, including `dist`.
The updater public key, entitlements, signing scripts, and variable names are
safe to publish. Distributed app signatures also expose the signing certificate
and identity; private keys and passwords must remain private.

Unsigned preview builds do not require these secrets. For production, keep
updater and Apple signing credentials separate: updater signatures protect
replacement payloads, while Developer ID/notarization establish macOS trust.

Tauri signs the Node **external binary** with the application. The Node runtime
is outside desktop resources specifically so it participates in signing.
The supplied macOS entitlements allow Node/V8 JIT execution after signing.
Node's license, engine dependency notices, and viewer dependency notices ship
with both the desktop and CLI archive.

Windows installers have cryptographically signed updater payloads, but they
stay Authenticode-unsigned for now, so SmartScreen warns on first run. Adding
Tauri's `bundle.windows` signing options or a `signCommand` is a separate,
deferred setup; the workflow does not invent a certificate or bypass SmartScreen.
On Linux the AppImage is the primary download and updates in place; `.deb`
installs also update in-app through the official updater (`pkexec dpkg -i`,
with an administrator prompt).

After reviewing all assets and checking a signed install/update on each OS,
publish the draft. The final workflow job writes one `latest.json` with every
platform entry; it becomes reachable at
`https://github.com/iplanwebsites/whyfull/releases/latest/download/latest.json`
only when the release is public. Installation prompts before stopping the scan,
verifies the update signature, replaces the full app including its engine,
and restarts it. Failed checks stay quiet on startup and show errors when
requested manually. This updater cannot be exercised end to end until a signed
release and a newer signed release are published.

## Release process

For the first signed release, test downloaded installers on every supported OS.
An update from a previous signed build becomes testable with the second signed
release. Windows Authenticode setup is still outstanding; the
metadata and release notes explicitly identify the Windows installer as unsigned.
Do not claim it is signed until the certificate provider and verification are
configured, and the metadata generator is updated to record that evidence.

1. Set `apps/desktop/package.json` to the intended desktop version, update the
   release notes, and commit/merge the changes. Desktop installers and portable
   archives share that version; the bundled engine keeps its own npm version.
   Preview desktop versions contain a prerelease suffix.
2. Run the workflow with `mode: build-only` first, then push `v<version>` (or
   dispatch with `mode: draft-release`). It runs native runtime/CLI checks,
   builds all platforms, and creates the draft with its files and metadata only
   after the complete matrix succeeds. macOS notarized
   builds additionally run `codesign --verify` and `spctl --assess`.
3. Download the actual installers and archives from the draft. Verify first
   launch, a report against a small fixture, CLI installation/arguments, and
   uninstall on macOS Apple Silicon/Intel, Windows x64, and Linux x64. Check the
   unsigned-preview instructions where applicable. For stable, verify desktop
   updates and the installed CLI after an update. Review `SHA256SUMS.txt` and
   the channel/signing values in `downloads.json`.
4. Add the changes for this version to the draft's notes. Publish the draft once the checks pass. The site
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
[Tauri GitHub pipelines](https://v2.tauri.app/distribute/pipelines/github/).

Both scanner choices now use the same SQLite inventory and bounded viewer
queries. Node workers also persist pending folders and hard-link ownership;
turning off Rust no longer restores the old in-memory inventory. Both paths
require the bundled Node 22.18+ runtime. Cached inventories are scanner-specific
SQLite files; portable JSON export/import remains supported.
