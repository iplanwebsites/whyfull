import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { releaseInfo } from "../scripts/release-info.mjs"
import { windowsSignCommand } from "../scripts/configure.mjs"
import {
  artifactSpecs,
  createManifest,
  updaterTargets,
} from "../scripts/release-manifest.mjs"
import {
  allPlatforms,
  assertNoPlatformLeaves,
  buildMatrix,
  downloadsFor,
  parsePlatforms,
  previousStableLatest,
  releaseNotes,
  releasePlatforms,
  updaterTargetsFor,
} from "../scripts/release-platforms.mjs"
import {
  collectAssets,
  createUpdaterManifest,
  platformFiles,
} from "../scripts/release-assets.mjs"

test("stable releases require notarization; previews need distinct prerelease versions", () => {
  assert.equal(releaseInfo({ version: "1.2.3" }).updater, true)
  assert.deepEqual(releaseInfo({ version: "1.2.4-preview.1" }), {
    version: "1.2.4-preview.1",
    tag: "v1.2.4-preview.1",
    channel: "preview",
    preview: true,
    macosSigning: "unsigned",
    windowsSigning: "unsigned",
    updater: false,
    buildOnly: false,
  })
  assert.throws(
    () => releaseInfo({ version: "1.2.3", channel: "preview" }),
    /prerelease version/
  )
  assert.throws(
    () => releaseInfo({ version: "1.2.3", macosSigning: "unsigned" }),
    /notarized/
  )
  assert.throws(
    () => releaseInfo({ version: "1.2.4-preview.1", channel: "stable" }),
    /plain version/
  )
  assert.throws(
    () => releaseInfo({ version: "1.2.3", updater: "off" }),
    /signed updates/
  )
})

test("build-only runs may skip notarization and updates but never enable preview updates", () => {
  const info = releaseInfo({
    version: "1.2.3",
    buildOnly: true,
    macosSigning: "unsigned",
    updater: "off",
  })
  assert.equal(info.updater, false)
  assert.equal(info.macosSigning, "unsigned")
  assert.equal(info.buildOnly, true)
  assert.equal(releaseInfo({ version: "1.2.3", buildOnly: true }).updater, true)
  assert.equal(
    releaseInfo({ version: "1.2.4-preview.1", buildOnly: true }).updater,
    false
  )
})

test("Windows signing stays off until the owner opts in through WHYFULL_WINDOWS_SIGNING", () => {
  const windows = (options) =>
    releaseInfo({ version: "1.2.3", ...options }).windowsSigning
  // Default: unsigned, for stable releases too.
  assert.equal(windows({}), "unsigned")
  assert.equal(windows({ windowsSigningProvider: "" }), "unsigned")
  assert.equal(windows({ windowsSigningProvider: "other" }), "unsigned")
  // auto signs once the variable is azure and the credentials exist.
  assert.equal(
    windows({ windowsSigningProvider: "azure", windowsCredentials: true }),
    "signed"
  )
  assert.equal(
    releaseInfo({
      version: "1.2.4-preview.1",
      windowsSigningProvider: "azure",
      windowsCredentials: true,
    }).windowsSigning,
    "signed"
  )
  // The no-secrets dry run (build-only with macOS unsigned) stays unsigned.
  assert.equal(
    windows({
      buildOnly: true,
      macosSigning: "unsigned",
      windowsSigningProvider: "azure",
      windowsCredentials: false,
    }),
    "unsigned"
  )
  assert.equal(
    windows({
      buildOnly: true,
      windowsSigningProvider: "azure",
      windowsCredentials: true,
    }),
    "signed"
  )
  // An opted-in repository with missing credentials fails instead of shipping unsigned.
  assert.throws(
    () =>
      windows({ windowsSigningProvider: "azure", windowsCredentials: false }),
    /AZURE_CLIENT_ID/
  )
  // signed forces signing and fails fast without credentials.
  assert.equal(
    windows({ windowsSigning: "signed", windowsCredentials: true }),
    "signed"
  )
  assert.throws(
    () => windows({ windowsSigning: "signed", windowsCredentials: false }),
    /Windows signing needs/
  )
  assert.equal(
    windows({
      windowsSigning: "unsigned",
      windowsSigningProvider: "azure",
      windowsCredentials: false,
    }),
    "unsigned"
  )
  // Later steps pass the resolved mode without credential information.
  assert.equal(windows({ windowsSigning: "signed" }), "signed")
  assert.throws(() => windows({ windowsSigning: "ev" }), /Unknown Windows/)
})

test("the Windows sign command uses Artifact Signing values from the environment", () => {
  const env = {
    WHYFULL_AZURE_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net",
    WHYFULL_AZURE_SIGNING_ACCOUNT: "whyfull",
    WHYFULL_AZURE_SIGNING_PROFILE: "Whyfull Public",
    AZURE_CLIENT_ID: "id",
    AZURE_CLIENT_SECRET: "secret",
    AZURE_TENANT_ID: "tenant",
  }
  const command = windowsSignCommand(env)
  assert.deepEqual(command, {
    cmd: "artifact-signing-cli",
    args: [
      "-e",
      "https://eus.codesigning.azure.net",
      "-a",
      "whyfull",
      "-c",
      "Whyfull Public",
      "-d",
      "Whyfull",
      "%1",
    ],
  })
  // Secrets stay in the environment, never in version.conf.json.
  assert.ok(!JSON.stringify(command).includes("secret"))
  assert.throws(
    () => windowsSignCommand({ ...env, AZURE_CLIENT_SECRET: "" }),
    /AZURE_CLIENT_SECRET/
  )
  assert.throws(
    () => windowsSignCommand({ ...env, WHYFULL_AZURE_SIGNING_PROFILE: " " }),
    /WHYFULL_AZURE_SIGNING_PROFILE/
  )
  assert.throws(
    () =>
      windowsSignCommand({
        ...env,
        WHYFULL_AZURE_SIGNING_ENDPOINT: "https://example.com",
      }),
    /codesigning\.azure\.net/
  )
})

async function fixture(t, version) {
  const directory = await mkdtemp(join(tmpdir(), "whyfull-release-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const [, name] of artifactSpecs)
    await writeFile(join(directory, name(version)), "release fixture")
  return directory
}

test("preview metadata requires all nine real artifacts and records their checksums", async (t) => {
  const version = "1.2.4-preview.1"
  const directory = await fixture(t, version)
  const manifest = await createManifest({ directory, version })
  assert.equal(manifest.macosSigning, "unsigned")
  assert.equal(manifest.windowsSigning, "unsigned")
  assert.equal(manifest.updater, false)
  assert.equal(manifest.downloads.length, 9)
  assert.equal(
    (await createManifest({ directory, version, windowsSigning: "signed" }))
      .windowsSigning,
    "signed"
  )
  assert.ok(
    manifest.downloads.every(
      (entry) =>
        entry.sha256 ===
        createHash("sha256").update("release fixture").digest("hex")
    )
  )
  await rm(join(directory, artifactSpecs[0][1](version)))
  await assert.rejects(
    () => createManifest({ directory, version }),
    /Missing release artifact/
  )
})

test("stable metadata requires complete signed update platforms and matching release assets", async (t) => {
  const version = "1.2.3"
  const directory = await fixture(t, version)
  const platforms = {}
  for (const [target, name] of updaterTargets) {
    platforms[target] = {
      signature: "fixture-signature",
      url: `https://github.com/iplanwebsites/whyfull/releases/download/v${version}/${name(version)}`,
    }
    await writeFile(join(directory, name(version)), "update fixture")
  }
  const update = { version, platforms }
  await writeFile(join(directory, "latest.json"), JSON.stringify(update))
  assert.equal((await createManifest({ directory, version })).updater, true)
  delete update.platforms["windows-x86_64"]
  await writeFile(join(directory, "latest.json"), JSON.stringify(update))
  await assert.rejects(
    () => createManifest({ directory, version }),
    /windows-x86_64/
  )
  update.platforms["windows-x86_64"] = update.platforms["linux-x86_64"]
  await writeFile(join(directory, "latest.json"), JSON.stringify(update))
  await assert.rejects(
    () => createManifest({ directory, version }),
    /windows-x86_64/
  )
  update.version = "1.2.2"
  await writeFile(join(directory, "latest.json"), JSON.stringify(update))
  await assert.rejects(
    () => createManifest({ directory, version }),
    /version mismatch/
  )
})

async function nativeBuild(t, version, platform, arch, root) {
  const bundleDir = join(root, `${platform}-${arch}/bundle`)
  const distDir = join(root, `${platform}-${arch}/dist`)
  const files = platformFiles({ version, platform, arch })
  for (const [source] of files.installers) {
    await mkdir(join(bundleDir, source, ".."), { recursive: true })
    await writeFile(join(bundleDir, source), `${platform} ${arch} installer`)
  }
  for (const { source } of files.updates) {
    await mkdir(join(bundleDir, source, ".."), { recursive: true })
    await writeFile(join(bundleDir, source), `${platform} ${arch} update`)
    await writeFile(join(bundleDir, `${source}.sig`), `sig:${source}\n`)
  }
  await mkdir(distDir, { recursive: true })
  await writeFile(join(distDir, files.cli), `${platform} ${arch} cli`)
  return { bundleDir, distDir }
}

test("per-platform collections merge into a latest.json the release validator accepts", async (t) => {
  const version = "1.2.3"
  const root = await mkdtemp(join(tmpdir(), "whyfull-assets-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const release = join(root, "release")
  await mkdir(release)
  for (const [platform, arch] of [
    ["darwin", "arm64"],
    ["darwin", "x64"],
    ["win32", "x64"],
    ["linux", "x64"],
  ]) {
    const outDir = join(root, `out-${platform}-${arch}`)
    await collectAssets({
      ...(await nativeBuild(t, version, platform, arch, root)),
      outDir,
      version,
      platform,
      arch,
      updater: true,
    })
    for (const name of await readdir(outDir))
      await writeFile(join(release, name), await readFile(join(outDir, name)))
  }
  const latest = await createUpdaterManifest({ directory: release, version })
  assert.deepEqual(
    Object.keys(latest.platforms).sort(),
    updaterTargets.map(([target]) => target).sort()
  )
  assert.equal(
    latest.platforms["darwin-x86_64"].signature,
    "sig:macos/Whyfull.app.tar.gz"
  )
  assert.ok(
    !(await readdir(release)).some((name) => name.startsWith("updater-"))
  )
  const manifest = await createManifest({ directory: release, version })
  assert.equal(manifest.downloads.length, 9)
  assert.ok(
    manifest.downloads.every(({ name }) => !name.endsWith(".app.tar.gz"))
  )
})

test("collection fails on missing updater signatures and unsupported platforms", async (t) => {
  const version = "1.2.3"
  const root = await mkdtemp(join(tmpdir(), "whyfull-assets-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const build = await nativeBuild(t, version, "linux", "x64", root)
  await rm(join(build.bundleDir, `deb/Whyfull_${version}_amd64.deb.sig`))
  const options = { ...build, outDir: join(root, "out"), version }
  await collectAssets({ ...options, platform: "linux", arch: "x64" })
  await assert.rejects(
    () =>
      collectAssets({
        ...options,
        platform: "linux",
        arch: "x64",
        updater: true,
      }),
    /Missing updater signature/
  )
  assert.throws(
    () => platformFiles({ version, platform: "linux", arch: "arm64" }),
    /Unsupported release platform/
  )
})

test("a Mac-only stable release validates exactly its own downloads and updater keys", async (t) => {
  const version = "1.2.3"
  const macs = ["macos-arm64", "macos-x64"]
  const directory = await mkdtemp(join(tmpdir(), "whyfull-subset-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const [, name] of downloadsFor(macs))
    await writeFile(join(directory, name(version)), "release fixture")
  const platforms = {}
  for (const [target, name] of updaterTargetsFor(macs)) {
    platforms[target] = {
      signature: "fixture-signature",
      url: `https://github.com/iplanwebsites/whyfull/releases/download/v${version}/${name(version)}`,
    }
    await writeFile(join(directory, name(version)), "update fixture")
  }
  const update = { version, platforms }
  await writeFile(join(directory, "latest.json"), JSON.stringify(update))
  const manifest = await createManifest({
    directory,
    version,
    platforms: macs,
  })
  assert.deepEqual(manifest.platforms, macs)
  assert.deepEqual(manifest.downloads.map(({ id }) => id).sort(), [
    "cli-macos-arm64",
    "cli-macos-x64",
    "desktop-macos-arm64",
    "desktop-macos-x64",
  ])
  // The full set is still required when not narrowed.
  await assert.rejects(
    () => createManifest({ directory, version }),
    /Missing release artifact/
  )
  // latest.json must not advertise a platform this release does not ship.
  update.platforms["windows-x86_64"] = update.platforms["darwin-x86_64"]
  await writeFile(join(directory, "latest.json"), JSON.stringify(update))
  await assert.rejects(
    () => createManifest({ directory, version, platforms: macs }),
    /outside this release: windows-x86_64/
  )
})

test("platform sets are validated, ordered, and become the build matrix", () => {
  assert.deepEqual(parsePlatforms("macos-x64, macos-arm64"), [
    "macos-arm64",
    "macos-x64",
  ])
  assert.throws(() => parsePlatforms(""), /at least one/)
  assert.throws(() => parsePlatforms("linux-arm64"), /Unknown/)
  assert.throws(() => parsePlatforms("macos-x64,macos-x64"), /Duplicate/)
  assert.deepEqual(buildMatrix(["macos-x64"]), {
    include: [{ name: "macos-x64", os: "macos-15-intel", bundles: "app" }],
  })
  // The committed set starts Mac-first.
  assert.deepEqual(releasePlatforms(), ["macos-arm64", "macos-x64"])
  assert.deepEqual(
    allPlatforms.flatMap((name) => buildMatrix([name]).include[0].os),
    ["macos-15", "macos-15-intel", "windows-latest", "ubuntu-22.04"]
  )
})

test("a stable platform can join but never leave", () => {
  const macs = ["macos-arm64", "macos-x64"]
  const latest = (names) => ({
    version: "1.0.0",
    platforms: Object.fromEntries(
      updaterTargetsFor(names).map(([target]) => [target, {}])
    ),
  })
  assert.doesNotThrow(() => assertNoPlatformLeaves(null, macs))
  assert.doesNotThrow(() => assertNoPlatformLeaves(latest(macs), macs))
  assert.doesNotThrow(() =>
    assertNoPlatformLeaves(latest(macs), [...macs, "linux-x64"])
  )
  assert.throws(
    () => assertNoPlatformLeaves(latest(macs), ["macos-arm64"]),
    /darwin-x86_64.*never leave/
  )
  assert.throws(
    () =>
      assertNoPlatformLeaves(latest([...macs, "windows-x64"]), [
        ...macs,
        "linux-x64",
      ]),
    /windows-x86_64/
  )
})

test("the previous stable manifest comes from GitHub's Latest release", async () => {
  const calls = []
  const fetcher = (responses) => async (url) => {
    calls.push(String(url))
    return responses(String(url))
  }
  assert.equal(
    await previousStableLatest({
      repository: "o/r",
      fetcher: fetcher(() => new Response(null, { status: 404 })),
    }),
    null
  )
  const previous = { version: "1.0.0", platforms: { "darwin-aarch64": {} } }
  const found = await previousStableLatest({
    repository: "o/r",
    fetcher: fetcher((url) =>
      url.endsWith("/releases/latest")
        ? Response.json({
            assets: [
              { name: "latest.json", browser_download_url: "https://x/l.json" },
            ],
          })
        : Response.json(previous)
    ),
  })
  assert.deepEqual(found, previous)
  assert.ok(calls.includes("https://api.github.com/repos/o/r/releases/latest"))
  await assert.rejects(
    () =>
      previousStableLatest({
        repository: "o/r",
        fetcher: fetcher(() => new Response(null, { status: 500 })),
      }),
    /500/
  )
})

test("release notes keep only the shipped platforms' instructions", async () => {
  const template = await readFile(
    new URL("../release-notes-stable.md", import.meta.url),
    "utf8"
  )
  const macOnly = releaseNotes(template, ["macos-arm64", "macos-x64"])
  assert.match(macOnly, /^- macOS:/m)
  assert.doesNotMatch(macOnly, /^- (Windows|Linux):/m)
  assert.match(macOnly, /Windows and Linux builds are not part of this release/)
  const all = releaseNotes(template, allPlatforms)
  assert.match(all, /^- Windows:.*not code-signed/m)
  assert.equal(
    releaseNotes(template, allPlatforms, { windowsSigning: "unsigned" }),
    all
  )
  const signed = releaseNotes(template, allPlatforms, {
    windowsSigning: "signed",
  })
  assert.match(signed, /^- Windows:.*Authenticode signed/m)
  assert.doesNotMatch(signed, /not code-signed/)
  assert.doesNotMatch(
    releaseNotes(template, ["macos-arm64"], { windowsSigning: "signed" }),
    /^- Windows:/m
  )
  assert.throws(
    () => releaseNotes(template, allPlatforms, { windowsSigning: "yes" }),
    /Unknown Windows/
  )
  assert.match(all, /^- Windows:/m)
  assert.match(all, /^- Linux:.*administrator password/m)
  assert.doesNotMatch(all, /not part of this release/)
})
