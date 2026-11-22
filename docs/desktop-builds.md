# Desktop build and release strategy

How the Whyfull desktop app (Tauri v2 shell + bundled Node sidecar engine) is
built, signed, updated and released on each platform. Workflow:
[`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml).
PR checks: [`.github/workflows/desktop-check.yml`](../.github/workflows/desktop-check.yml).

Status (2026-11): only macOS Apple Silicon has been built, and only on a local
machine. None of the CI release paths has run on GitHub yet.

## Pipeline shape

```
prepare (ubuntu)        validate version/channel/signing; refuse a published release;
                        pick the platform set; stable: no platform may leave
build × N (native)      one job per selected platform: prepare runtime → tests → tauri build → smoke test → sign/notarize
                        → CLI archive → collect files → upload *workflow artifact* only
finalize (ubuntu)       download all artifacts → assemble latest.json → validate exactly
                        the selected downloads + updater keys → recheck continuity →
                        (draft-release only) create the draft and attach everything,
                        metadata last
```

Each build job only uploads a workflow artifact. Only `finalize` writes to
GitHub Releases, and it runs only after every selected platform succeeded. The draft is
therefore never left half-filled, and no two jobs ever read and rewrite
`latest.json` at the same time. With `tauri-action`, the four jobs each
downloaded, merged, deleted and re-uploaded `latest.json` with no locking, so a
platform could silently drop out. The workflow now calls the Tauri CLI directly.
The CLI reads the same signing environment variables (`APPLE_*`, `TAURI_SIGNING_*`).
Windows Authenticode goes through `bundle.windows.signCommand`; the Azure
credentials it needs (`AZURE_*`) reach only the Windows job.

Scripts:

| Script                          | Role                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/prepare.mjs`           | Builds the engine bundle; copies the running `node` as `binaries/whyfull-node-<rust host triple>`; on macOS/Linux builds `experiments/disk-crawler` as `binaries/whyfull-crawler-<triple>` |
| `scripts/configure.mjs`         | Writes `src-tauri/version.conf.json`: version, `externalBin` list (crawler only on macOS/Linux), updater pubkey + endpoint for stable, Windows `signCommand` with `--windows-signing`      |
| `scripts/dmg.mjs`               | Finder-free DMG `Whyfull_<v>_<aarch64 or x64>.dmg`, Developer ID signed when an identity is set                                                                                            |
| `scripts/archive-cli.mjs`       | Portable CLI `whyfull-<v>-<platform>-<arch>.tar.gz or zip`                                                                                                                                 |
| `scripts/release-assets.mjs`    | `collect`: copy one runner's files under final asset names + an updater fragment; `latest`: merge fragments into `latest.json`                                                             |
| `scripts/release-manifest.mjs`  | Validates exactly the selected platforms' downloads and updater keys; writes `downloads.json` (with `platforms`) and `SHA256SUMS.txt`                                                      |
| `scripts/release-platforms.mjs` | Platform table (runner, bundles, downloads, updater keys), build matrix, previous-stable continuity check, per-platform release notes                                                      |
| `release-platforms.json`        | The committed platform set for draft releases (stable and preview). Today: `macos-arm64`, `macos-x64`                                                                                      |
| `scripts/release-info.mjs`      | Channel/signing/updater rules shared by every step                                                                                                                                         |

### Sidecars per platform

| Runner           | Rust host                  | `whyfull-node` source         | `whyfull-crawler`                                                                               |
| ---------------- | -------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `macos-15`       | `aarch64-apple-darwin`     | setup-node arm64 `node`       | native cargo build, arm64                                                                       |
| `macos-15-intel` | `x86_64-apple-darwin`      | setup-node x64 `node`         | native cargo build, x86_64                                                                      |
| `ubuntu-22.04`   | `x86_64-unknown-linux-gnu` | setup-node linux-x64 `node`   | native cargo build, x86_64 glibc                                                                |
| `windows-latest` | `x86_64-pc-windows-msvc`   | setup-node win-x64 `node.exe` | not built; the engine uses the Node scanner (the Rust scanner option reports it is unavailable) |

`prepare.mjs` copies `process.execPath` and names it after `rustc -vV`'s host.
Both values come from the runner itself, so **every installer must be built on a
native runner of its own architecture**. Cross-compiling only the Rust shell (for example
`--target x86_64-apple-darwin` on an arm64 Mac) would ship an arm64 Node and
crawler inside an "Intel" app. That is why Intel uses `macos-15-intel` and not a
`--target` build. The build job runs a "Check sidecars match this runner" step
that prints `file` output for both binaries.

## Blockers to fix before the first CI run

These come from the working tree, not from the workflow:

1. **`experiments/disk-crawler/` is untracked.** `prepare.mjs` runs
   `cargo build --manifest-path experiments/disk-crawler/Cargo.toml` on macOS
   and Linux. On a CI checkout this file is missing, so both Macs and Linux fail.
   Commit `Cargo.toml`, `Cargo.lock` and `src/`. Ignore its `target/` (and
   `results/` if they are local benchmark output) first: the root `.gitignore`
   does not cover `experiments/disk-crawler/target/`.
2. **`packages/whyfull/scripts/build-native.mjs` is untracked**, but the
   `whyfull` build script runs it, so `pnpm desktop:prepare` fails on **all four**
   platforms. Commit it.
3. Push the 5 local commits together with the workflow changes. `workflow_dispatch` only
   appears in the Actions UI after the workflow file is on the default branch.
4. Use a new desktop version (`0.0.2`, or `0.0.2-preview.1` first). `0.0.1`
   already exists as the locally built, R2-hosted Mac download.

## Per-platform strategy

### macOS Apple Silicon (`macos-15`, `--bundles app`)

- Toolchain: Xcode CLT from the image, Rust stable (≥ 1.90), Node 22.23.2, pnpm 9.12.
- Signing: Tauri imports `APPLE_CERTIFICATE` into a temporary keychain. It then signs the
  app and both external binaries with `Entitlements.plist` (JIT for V8), notarizes
  and staples. Next, `dmg.mjs` builds the DMG and signs it, and the workflow notarizes and
  staples it. Previews and build-only runs may use ad-hoc signing (`-`).
- Updater artifact: `Whyfull.app.tar.gz` + `.sig`, renamed to
  `Whyfull_<v>_aarch64.app.tar.gz`. Keys `darwin-aarch64` and `darwin-aarch64-app`.
- Installer: `Whyfull_<v>_aarch64.dmg`. CLI: `whyfull-<v>-darwin-arm64.tar.gz`.
- Verdict: **likely works**. The same scripts produced the local 0.0.1 build. CI
  differs only in keychain import and notarization through env vars.
- Risks: notarization latency or outages (the job waits); an Apple ID
  app-specific password that was revoked.
- Test the installer: download the DMG from the draft, then run
  `spctl -a -vvv -t install Whyfull_*.dmg`, drag to Applications, first launch, run a scan,
  use _Install command-line tool…_, then `whyfull --json | head`.
- Test an update: install release N from its DMG. Publish N+1 (or point a
  test build at a staging `latest.json`, see below). Then _Check for updates…_
  → accept → app restarts → _About_ shows N+1 and `whyfull --version` follows.

### macOS Intel (`macos-15-intel`, `--bundles app`)

- Same as Apple Silicon, built natively on x86_64. Node, Rust and the crawler
  are all x86_64. `dmg.mjs` names the DMG `_x64`.
- Updater artifact: `Whyfull_<v>_x64.app.tar.gz`, keys `darwin-x86_64`,
  `darwin-x86_64-app`. Both Macs produce `Whyfull.app.tar.gz`, so the rename in
  `release-assets.mjs` keeps them from overwriting each other.
- Verdict: **likely works**, never exercised.
- Risks: `macos-15-intel` is GitHub's last Intel image and will be retired, likely in 2027. After that, build Intel with `--target x86_64-apple-darwin` on arm64.
  `prepare.mjs` would then need to download the official
  `node-v22.x-darwin-x64` binary and build the crawler with `--target`, instead of
  copying the host's. Alternatively, ship a universal app.
  The Intel queue is often slower.
- Test: same as Apple Silicon on an Intel Mac.
  `file /Applications/Whyfull.app/Contents/MacOS/*` must show only x86_64.

### Windows x64 (`windows-latest`, `--bundles nsis`)

- Toolchain: MSVC from the image, Rust stable, Node 22.23.2. Tauri downloads NSIS
  and `nsis_tauri_utils` itself.
- Sidecar: `whyfull-node-x86_64-pc-windows-msvc.exe` (the official `node.exe`,
  which keeps its OpenJS Authenticode signature after renaming). No crawler.
- Signing: **optional Authenticode through Azure Artifact Signing, off by
  default**. Until the owner opts in (see
  [Windows code signing](#windows-code-signing-azure-artifact-signing)) the
  installer stays unsigned. The updater payload is minisign-signed either way,
  so updates are verified even without Authenticode. `downloads.json` records
  `windowsSigning` as `signed` or `unsigned`, and the download page shows it.
  The release notes pick the matching Windows line.
- Updater artifact: `Whyfull_<v>_x64-setup.exe` + `.sig`, keys `windows-x86_64`
  and `windows-x86_64-nsis`. The NSIS installer defaults to per-user install
  (`%LOCALAPPDATA%`), so updates need no admin rights. The updater stops the
  engine before running the installer.
- Installer: `Whyfull_<v>_x64-setup.exe`. CLI: `whyfull-<v>-win32-x64.zip`.
- Verdict: **probably works, highest uncertainty**. The Rust code compiles for
  Windows in principle, but the Windows engine paths and NSIS packaging have
  never run.
- Risks:
  - SmartScreen (unsigned): Edge may first say the file "isn't commonly downloaded" (… →
    Keep). Running it shows "Windows protected your PC" with publisher
    "Unknown publisher"; users choose **More info → Run anyway**. The release notes
    say this and ask users to compare the SHA-256 first. Reputation for unsigned
    files resets with every new file hash, so expect the warning on every version.
    In-app updates are not affected, because the updater runs the installer
    directly and never goes through the download prompt.
  - SmartScreen (signed): the publisher name shows instead of "Unknown
    publisher". Reputation builds on the signing identity, so early signed
    versions may still warn.
  - The `--cli` launcher uses a GUI-subsystem exe plus `AttachConsole`.
    Stdout/exit codes through `whyfull.cmd` in `cmd.exe` and PowerShell need a manual check.
  - Defender may slow first launch while it scans the 80 MB Node binary.
  - Engine behavior on Windows (drive discovery, paths) belongs to
    `packages/whyfull`, not to the build.
- Test the installer: run the setup exe (unsigned: expect SmartScreen → _More info → Run
  anyway_; signed: the file's Properties → Digital Signatures tab shows the
  publisher), launch from Start, scan, _Install command-line tool…_, then in a new
  `cmd.exe`: `%USERPROFILE%\AppData\Local\Whyfull\bin\whyfull.cmd --json`.
  Check `echo %ERRORLEVEL%`. Uninstall from Settings → Apps.
- Test an update: as on macOS. The installer runs in passive mode and the app
  restarts.

### Linux x64 (`ubuntu-22.04`, `--bundles appimage,deb`)

- Toolchain: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
xdg-utils` (the Tauri v2 prerequisites). Use Ubuntu 22.04 so the binaries need
  only glibc 2.35. Node's official binary needs glibc ≥ 2.28.
- Sidecars: `whyfull-node` and `whyfull-crawler` in `usr/bin` (both bundles).
- Updater artifacts: AppImage + `.sig` (keys `linux-x86_64`,
  `linux-x86_64-appimage`), and **`.deb` + `.sig` (key `linux-x86_64-deb`)**.
  tauri-plugin-updater 2.14 looks up `{os}-{arch}-{bundle}` first. A `.deb`
  install with no `-deb` key would fall back to the AppImage and fail with
  `InvalidUpdaterFormat` on every accepted update. With the key, the plugin installs the
  new `.deb` via `pkexec dpkg -i` (an admin password prompt). Tauri CLI 2.12 signs `.deb`
  when `createUpdaterArtifacts` is `true`. The collect step fails if that
  `.deb.sig` is missing, so the first signed build-only run confirms it.
- Installers: `Whyfull_<v>_amd64.AppImage`, `Whyfull_<v>_amd64.deb`. CLI:
  `whyfull-<v>-linux-x64.tar.gz`.
- Product decision: the **AppImage is the primary Linux download**, with in-app
  updates. The **.deb also updates in-app** through the official updater path
  (`pkexec dpkg -i`, administrator prompt). The release notes say both.
- Verdict: **likely builds**. AppImage runtime portability is the main unknown.
- Risks: WebKitGTK AppImages bundle GTK/WebKit and can show blank windows or
  EGL errors on newer distros (Fedora, Arch, NVIDIA). The usual workaround is
  `WEBKIT_DISABLE_DMABUF_RENDERER=1`. linuxdeploy `strip` can fail on newer
  binaries (workaround `NO_STRIP=true`). The AppImage needs FUSE 2 on the user's
  machine (`libfuse2`) or `--appimage-extract-and-run`.
- Test the installer: on Ubuntu 22.04/24.04 and one non-Debian distro, run
  `chmod +x Whyfull_*.AppImage && ./Whyfull_*.AppImage`, scan, install the CLI
  (`~/.local/bin/whyfull` must reference the AppImage path, not `/tmp/.mount_*`),
  and run `whyfull --json`. Install the deb with `sudo apt install ./Whyfull_*.deb`, then
  launch from the menu and run `whyfull --cli --help` from `/usr/bin`.
- Test an update: AppImage N → N+1 replaces the file in place (the file must be
  writable). For deb, accept the prompt and enter the admin password, then check
  `dpkg -s whyfull` (or the package name Tauri derives) for N+1.

## Updater invariants

- Only stable builds embed the updater config (`configure.mjs`). Previews and
  `updater: off` build-only runs have no pubkey and never check.
- The endpoint is
  `https://github.com/iplanwebsites/whyfull/releases/latest/download/latest.json`.
  It resolves only through GitHub's **Latest** (published, non-prerelease) release.
- `release-manifest.mjs` requires exactly the selected platforms' keys (2 per Mac,
  2 for Windows, 3 for Linux) and rejects extra keys. Each key must point at an
  existing asset of the same tag. Bare keys must point at the preferred bundle
  (AppImage, NSIS, `.app.tar.gz`).
- **A platform may join the stable channel, but never leave it** (enforced).
  `release-platforms.mjs previous` downloads `latest.json` from GitHub's Latest
  release, the one installed copies follow. `continuity` fails if any of its keys
  would be missing from the new set. It runs in `prepare` (before building) and
  again in `finalize` (before uploading), for every stable run, build-only
  included. A removed platform's installs would otherwise get "target not found"
  and never update again.
- Keep the updater private key forever. Losing it strands every installed copy.
  The local 0.0.1 build was signed with some key. If you reuse that key pair
  for CI, 0.0.1 users also receive updates, which is a bonus rather than a requirement.

## Release gating policy

**Decided: stable ships the committed platform set, Mac-first.**
`apps/desktop/release-platforms.json` lists the platforms of every draft release
(stable and preview). The tag stays the trigger. Today the set is `macos-arm64` +
`macos-x64`: their DMGs, CLI archives and 4 updater keys.

- Only the listed platforms' build jobs run (`prepare` emits the matrix).
  `finalize` needs all of them. Within the set it is still all-or-nothing: one
  failing Mac blocks the release, and nothing is uploaded.
- `downloads.json` and `SHA256SUMS.txt` list exactly those files, and `latest.json`
  lists exactly those updater keys.
- The download page (`apps/brochure/worker/downloads.ts`) accepts any non-empty
  set of known, unique ids that are attached to the release. The page already hides
  missing files and platform groups, and shows "coming soon". Its primary
  button offers only an available file (tested in `apps/brochure/test/downloads.test.mjs`).
- The R2-hosted 0.0.1 listing is served only while GitHub reports no published
  release with `downloads.json`. Once one exists, the page uses it (tested). One
  edge remains: if the GitHub API fails at that moment (for example rate limits on
  shared worker IPs), `worker/index.ts` still falls back to the R2 0.0.1 listing
  for that 5-minute cache window. Remove the R2 fallback once 0.0.2 is published.
- Release notes are generated from the template for the set
  (`release-platforms.mjs notes`). Missing platforms' bullets are dropped, and a
  "not part of this release yet" line is added.
- To add a platform, add it to `release-platforms.json` in the release commit.
  After that release it can never be removed (enforced).

### Platform entry criteria

Windows x64 and Linux x64 join `release-platforms.json` only when all of these hold:

1. A `mode: build-only` run with `build_platforms: all` passes for that
   platform. Run it signed (updater `auto`), so its updater signatures (including
   `.deb.sig`) and its keys in the assembled `latest.json` are proven.
2. Someone has hand-tested that run's artifacts on real machines. The full
   install checklist from the platform section must pass:
   - Linux: **Ubuntu 24.04 and Fedora** (current release). Cover the AppImage on
     both, and the `.deb` on Ubuntu.
   - Windows: Windows 11 x64 (and Windows 10 if still targeted). Include
     SmartScreen, `whyfull.cmd`, and uninstall.
3. An update has been exercised on that platform, from one signed build-only
   build to the next, using the local `latest.json` method under Dry runs.
4. The release notes and the download page copy for that platform are accurate.

Joining is permanent, so this bar sits before the first stable that ships the
platform. Previews could ship it earlier, but they share `release-platforms.json`
today. Iterate in build-only mode instead.

## Dry runs

`workflow_dispatch` with **`mode: build-only`** (the default for manual runs)
builds all 4 platforms. It then runs the same `collect` → `latest` → manifest
validation and stores installers, `downloads.json`, `SHA256SUMS.txt` and
`latest.json` as workflow artifacts (14 days). It never creates, edits or
publishes a GitHub release. Suggested order:

Manual runs choose `build_platforms`: `all` (default, builds all 4 even if they
are not in the release set) or `release` (only the committed set). Draft
releases always use the committed set.

1. **Desktop checks** (`desktop-check.yml`, dispatch). Compiles and smoke-tests on all
   4 OSes (Intel added) with the release sidecar list. No bundling.
2. **Build-only, no secrets**: `mode: build-only`, `macos_signing: unsigned`,
   `updater: off`. Proves NSIS/AppImage/deb/Intel packaging and gives
   installable (unsigned) artifacts to try on real machines.
3. **Build-only, fully signed** (after the secret setup): `mode: build-only`, all
   `auto`. Proves notarization, the updater signatures (including `.deb.sig`) and the
   assembled `latest.json` (9 keys with `build_platforms: all`), still without a release.
   With `WHYFULL_WINDOWS_SIGNING=azure` this also proves Authenticode; set
   `windows_signing: signed` to make the run fail if anything is missing.
4. **Preview draft**: set `0.0.2-preview.1`, push tag `v0.0.2-preview.1`. Creates a
   prerelease draft. Publishing it is safe because it is not the updater feed.
5. **Stable draft**: set `0.0.2`, push `v0.0.2`, test, then publish.

Testing an update before two stable releases exist: install a build-only signed
build N. Bump to N+1 and run build-only again. Take `latest.json` from its
`release-metadata` artifact. Edit its URLs to point at the N+1 updater files hosted
somewhere you control (for example a local `python3 -m http.server`). Then point a local build's endpoint at that file. The
endpoint lives in `configure.mjs` and the pubkey must be the same. Simpler but
later: the first real update test is 0.0.2 → 0.0.3.

## One-time secret setup (run yourself)

Names only; never paste values into issues, commits or chat.

| Name                                 | Kind     | Used for                                        |
| ------------------------------------ | -------- | ----------------------------------------------- |
| `WHYFULL_UPDATER_PUBLIC_KEY`         | Variable | Embedded updater trust key (contents of `.pub`) |
| `TAURI_SIGNING_PRIVATE_KEY`          | Secret   | Signs updater artifacts                         |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Secret   | Updater key password (skip if the key has none) |
| `APPLE_CERTIFICATE`                  | Secret   | Base64 Developer ID Application `.p12`          |
| `APPLE_CERTIFICATE_PASSWORD`         | Secret   | `.p12` export password                          |
| `APPLE_SIGNING_IDENTITY`             | Secret   | e.g. `Developer ID Application: Name (TEAMID)`  |
| `APPLE_ID`                           | Secret   | Apple ID for notarytool                         |
| `APPLE_PASSWORD`                     | Secret   | App-specific password for that Apple ID         |
| `APPLE_TEAM_ID`                      | Secret   | 10-character team id                            |

Windows Authenticode names are listed under
[Windows code signing](#windows-code-signing-azure-artifact-signing).

```sh
R=iplanwebsites/whyfull
# Updater key (once; keep the private key backed up outside the repo)
pnpm --filter @whyfull/desktop tauri signer generate -w ~/secure/whyfull-updater.key
gh variable set WHYFULL_UPDATER_PUBLIC_KEY -R $R < ~/secure/whyfull-updater.key.pub
gh secret set TAURI_SIGNING_PRIVATE_KEY -R $R < ~/secure/whyfull-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R $R   # prompts; paste the key password

# Apple Developer ID (export the "Developer ID Application" cert + key as .p12 from Keychain Access)
base64 -i ~/secure/developer-id.p12 | gh secret set APPLE_CERTIFICATE -R $R
gh secret set APPLE_CERTIFICATE_PASSWORD -R $R          # prompts
security find-identity -v -p codesigning                # copy the Developer ID Application name
gh secret set APPLE_SIGNING_IDENTITY -R $R               # prompts
gh secret set APPLE_ID -R $R                             # prompts
gh secret set APPLE_PASSWORD -R $R                       # app-specific password from appleid.apple.com
gh secret set APPLE_TEAM_ID -R $R                        # prompts

gh secret list -R $R && gh variable list -R $R           # names only
```

## Windows code signing (Azure Artifact Signing)

Azure Artifact Signing (formerly Trusted Signing; Basic is listed at
$9.99/month) issues short-lived certificates from Microsoft's HSMs. There is
no key to export. Nothing changes until `WHYFULL_WINDOWS_SIGNING` is `azure`.

How the workflow uses it:

- Input `windows_signing`: `auto` (default) signs only when the repository
  variable `WHYFULL_WINDOWS_SIGNING` is `azure`, except on a build-only run
  with `macos_signing: unsigned` (the no-secrets dry run). `signed` forces
  signing, `unsigned` skips it. `prepare` resolves it in `release-info.mjs`
  (output `windows_signing`). It fails when signing is chosen but a variable or
  secret is missing. It never sees the secret values, only whether they are set.
- Only the Windows build job gets the values, and only when signing. It
  installs `artifact-signing-cli` 0.12.0 (the renamed `trusted-signing-cli`
  from Tauri's docs, same flags) and points it at the newest SDK `signtool.exe`
  and the runner's Azure CLI. `configure.mjs --windows-signing` writes
  `bundle.windows.signCommand`:
  `artifact-signing-cli -e <endpoint> -a <account> -c <profile> -d Whyfull %1`.
  Tauri runs it for the app exe, the sidecar and the NSIS installer. The CLI reads
  `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_TENANT_ID` from the
  environment, so no secret lands in `version.conf.json`.
- After the build, `Get-AuthenticodeSignature` must report `Valid` for
  `whyfull-desktop.exe`, `whyfull-node.exe` and the setup exe.
- `downloads.json` records `windowsSigning: signed`, the download page says
  "Code-signed installer", and the release notes drop the "not code-signed" line.

Owner steps (manual, outside CI):

1. In the Azure portal, create a subscription if needed and register the
   `Microsoft.CodeSigning` resource provider.
2. Create an Artifact Signing account. Note its region endpoint, for example
   `https://eus.codesigning.azure.net`.
3. Under the account, start identity validation (Public, individual or
   organization) and wait until it is approved. Without approval, no
   certificate profile can be created.
4. Create a **Public Trust** certificate profile from that validation.
5. In Microsoft Entra ID, register an app (for example `whyfull-release`) and
   create a client secret. Note the expiry, because CI breaks when it expires.
6. On the Artifact Signing account (Access control (IAM)), assign that app the
   **Trusted Signing Certificate Profile Signer** role (newer portals may call
   it _Artifact Signing Certificate Profile Signer_).
7. Set the names below, then run a signed build-only dry run.

| Name                             | Kind     | Used for                                       |
| -------------------------------- | -------- | ---------------------------------------------- |
| `WHYFULL_WINDOWS_SIGNING`        | Variable | `azure` turns on `auto` signing                |
| `WHYFULL_AZURE_SIGNING_ENDPOINT` | Variable | Account region endpoint (`https://…azure.net`) |
| `WHYFULL_AZURE_SIGNING_ACCOUNT`  | Variable | Artifact Signing account name                  |
| `WHYFULL_AZURE_SIGNING_PROFILE`  | Variable | Certificate profile name                       |
| `AZURE_CLIENT_ID`                | Secret   | App registration (client) id                   |
| `AZURE_CLIENT_SECRET`            | Secret   | App registration client secret                 |
| `AZURE_TENANT_ID`                | Secret   | Entra tenant id                                |

```sh
R=iplanwebsites/whyfull
gh variable set WHYFULL_AZURE_SIGNING_ENDPOINT -R $R     # prompts
gh variable set WHYFULL_AZURE_SIGNING_ACCOUNT -R $R      # prompts
gh variable set WHYFULL_AZURE_SIGNING_PROFILE -R $R      # prompts
gh secret set AZURE_CLIENT_ID -R $R                       # prompts
gh secret set AZURE_CLIENT_SECRET -R $R                   # prompts
gh secret set AZURE_TENANT_ID -R $R                       # prompts

# Signed Windows dry run, before turning auto on. No Apple or updater secrets
# needed; an explicit `signed` overrides the macos_signing=unsigned exemption.
gh workflow run desktop-release.yml -R $R -f mode=build-only \
  -f macos_signing=unsigned -f updater=off -f windows_signing=signed
# Once it passed and the installer checked out on a real machine:
gh variable set WHYFULL_WINDOWS_SIGNING -R $R --body azure
```

The dry run builds every platform (`build_platforms: all`); the Windows job's
"Verify Windows Authenticode signatures" step shows each file's status and
signer. Download `whyfull-windows-x64` and check the setup exe's Digital
Signatures tab on Windows. To go back to unsigned, delete the
`WHYFULL_WINDOWS_SIGNING` variable (or pass `windows_signing: unsigned`).

## Pre-publish checklist (maintainer only, not for release notes)

- [ ] `finalize` succeeded: the set's downloads (4 for the Mac-only set),
      `SHA256SUMS.txt`, `downloads.json` (its `platforms` match
      `release-platforms.json`) and, for stable, `latest.json` with only those keys
      are on the draft.
- [ ] Draft notes: add the changes for this version under the template text.
- [ ] Installers downloaded _from the draft_ tested on every platform in the
      set (today macOS arm64 and Intel): first launch, scan, CLI install,
      `whyfull --json`, uninstall.
- [ ] Preview only: unsigned macOS first-launch instructions still accurate.
- [ ] Stable: `downloads.json` has channel `stable`, macosSigning `notarized`
      and updater `true`. Once Windows is signed, windowsSigning is `signed`. From the second stable release on, update N-1 → N on
      each platform once.
- [ ] Publishing stable marks it **Latest**. Never mark a preview or an npm-only
      release Latest.

## Decisions

Made (2026-11):

- **Mac-first stable**: implemented through `release-platforms.json` and the
  join-never-leave check.
- **Windows signing is optional, off by default** (implemented 2026-11). The
  desktop app asks for a $19 license after its trial
  ([business model](business-model.md)), and "Unknown publisher" on every
  version undercuts a paid app. Releases stay unsigned until the owner enrolls
  in Azure Artifact Signing and sets `WHYFULL_WINDOWS_SIGNING=azure`. If a solo
  developer can't pass its identity validation, an OV certificate on a cloud HSM
  is the fallback (a different `signCommand`). Windows joins stable only after
  the platform entry criteria, ideally with a signed build-only run.
- **Linux**: the AppImage is primary with in-app updates. The `.deb` also updates
  in-app through the official `pkexec dpkg -i` path. Linux joins after the entry
  criteria (Ubuntu 24.04 + Fedora).

Still open:

1. **Linux arm64 / Windows arm64.** Not built. Native `ubuntu-24.04-arm` and
   `windows-11-arm` runners exist. Each needs a `release-platforms.mjs` entry
   (updater keys `linux-aarch64`, `windows-aarch64`) and brochure ids. Windows
   arm64 also needs an arm64 Node. Defer until x64 is stable.
2. **Intel Mac end of life.** Intel is now in the stable set, so it can never
   leave. Before GitHub retires `macos-15-intel`, switch to the
   `--target x86_64-apple-darwin` + downloaded Node path, or to a universal app.
   Dropping Intel is no longer an option.
3. **Previews and the platform set.** Previews share `release-platforms.json`. If
   you want previews that test Windows/Linux before they join stable, add a
   separate `preview` list.
4. **R2 0.0.1 fallback**: delete it after 0.0.2 is published (see the gating section).
