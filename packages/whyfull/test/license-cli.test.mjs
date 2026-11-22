import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { generateKeyPairSync, sign } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CLI_LICENSE_TERMS,
  DesktopLicense,
  LICENSE_PAGES,
  LICENSE_PRICE,
  TRIAL_DAYS,
  encodeLicensePayload,
  licensePath,
  runLicenseCli,
} from "../dist/index.mjs"

const cli = new URL("../dist/cli.mjs", import.meta.url).pathname
const pair = generateKeyPairSync("ed25519")
const publicKey = pair.publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64")
function issue(fields = {}) {
  const body = encodeLicensePayload({
    v: 1,
    product: "whyfull-desktop",
    id: "WF-TESTORDER01",
    name: "Ada",
    issued: "2026-11-22",
    ...fields,
  })
  return `WHYFULL-${body}.${sign(null, Buffer.from(body), pair.privateKey).toString("base64url")}`
}
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "whyfull-license-cli-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, config: join(root, "config.json") }
}
/** In-process run with the test public key; the binary always uses the shipped one. */
async function run(argv, config, io = {}) {
  let stdout = ""
  let stderr = ""
  const code = await runLicenseCli([...argv, "--config", config], {
    publicKey,
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
    ...io,
  })
  return { code, stdout, stderr }
}
function bin(args, config, input) {
  const result = spawnSync(
    process.execPath,
    [cli, "license", ...args, "--config", config],
    {
      encoding: "utf8",
      input,
      timeout: 20000,
      env: { ...process.env, NO_COLOR: "1" },
    }
  )
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}
const usage = (config) =>
  existsSync(licensePath(config))
    ? JSON.parse(readFileSync(licensePath(config), "utf8")).usageDays
    : 0

test("status reports each desktop state in a stable JSON shape", async (t) => {
  const { config } = fixture(t)
  const json = async () =>
    JSON.parse((await run(["status", "--json"], config)).stdout)

  const fresh = await json()
  assert.deepEqual(Object.keys(fresh), [
    "format",
    "version",
    "cli",
    "desktop",
    "price",
    "links",
    "file",
  ])
  assert.equal(fresh.format, "whyfull-license")
  assert.equal(fresh.version, 1)
  assert.deepEqual(fresh.cli, { free: true, terms: CLI_LICENSE_TERMS })
  assert.deepEqual(Object.keys(fresh.desktop), [
    "state",
    "licensed",
    "holder",
    "licenseId",
    "trialDays",
    "usageDays",
    "trialRemaining",
    "summary",
  ])
  assert.equal(fresh.desktop.state, "trial")
  assert.equal(fresh.desktop.trialRemaining, TRIAL_DAYS)
  assert.equal(fresh.price, LICENSE_PRICE)
  assert.deepEqual(fresh.links, LICENSE_PAGES)
  assert.equal(fresh.file, licensePath(config))
  assert.equal(existsSync(licensePath(config)), false, "status never writes")

  // Three days of desktop use.
  let now = new Date(2026, 0, 1, 12)
  const desktop = new DesktopLicense({ policyFile: config, clock: () => now })
  for (let day = 1; day <= 3; day++) {
    now = new Date(2026, 0, day, 12)
    desktop.recordUse()
  }
  const trial = await run([], config)
  assert.equal(trial.code, 0)
  assert.match(trial.stdout, new RegExp(`3 of ${TRIAL_DAYS} days used`))
  assert.match(trial.stdout, new RegExp(`${TRIAL_DAYS - 3} days left`))
  assert.ok(trial.stdout.includes(LICENSE_PAGES.buy))
  assert.ok(trial.stdout.includes(LICENSE_PAGES.legal))
  assert.equal((await json()).desktop.usageDays, 3)

  for (let day = 4; day <= TRIAL_DAYS + 2; day++) {
    now = new Date(2026, 0, day, 12)
    desktop.recordUse()
  }
  const ended = await json()
  assert.equal(ended.desktop.state, "trial-ended")
  assert.equal(ended.desktop.trialRemaining, 0)
  assert.match((await run(["status"], config)).stdout, /Trial ended/)
  assert.equal(usage(config), TRIAL_DAYS + 2, "the CLI added no day")
})

test("activate accepts a key, a purchase link, or stdin, and never prints the key", async (t) => {
  const { config } = fixture(t)
  const key = issue()
  for (const [argv, io] of [
    [["activate", key], {}],
    [["activate", `https://whyfull.app/activate#key=${key}`], {}],
    [["activate", "-"], { readStdin: () => `Your key:\n  ${key}\n` }],
  ]) {
    rmSync(licensePath(config), { force: true })
    const result = await run(argv, config, io)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /Activated/)
    assert.match(result.stdout, /Licensed to Ada · License ID WF-TESTORDER01/)
    assert.ok(!result.stdout.includes(key), "the key itself is never printed")
    // The desktop app reads the same license.json.
    const app = new DesktopLicense({ policyFile: config, publicKey })
    assert.equal(app.status().licensed, true)
  }
  const report = JSON.parse((await run(["status", "--json"], config)).stdout)
  assert.equal(report.desktop.state, "licensed")
  assert.equal(report.desktop.holder, "Ada")
  assert.equal(report.desktop.licenseId, "WF-TESTORDER01")
  assert.ok(!JSON.stringify(report).includes(key))
  assert.equal(usage(config), 0, "activation counts no trial day")

  const json = await run(["activate", key, "--json"], config)
  assert.equal(JSON.parse(json.stdout).desktop.licensed, true)
})

test("invalid keys fail with exit 1 and leave the license untouched", async (t) => {
  const { config } = fixture(t)
  await run(["activate", issue()], config)
  const forged = issue().slice(0, -4) + "AAAA"
  const bad = await run(["activate", forged], config)
  assert.equal(bad.code, 1)
  assert.match(bad.stderr, /valid Whyfull license key/)
  assert.ok(!bad.stderr.includes(forged))
  assert.equal(
    JSON.parse((await run(["status", "--json"], config)).stdout).desktop
      .licensed,
    true
  )
  // The real binary only trusts the shipped key: a test-signed key is invalid.
  const shipped = bin(["activate", "-"], config, issue())
  assert.equal(shipped.code, 1)
  assert.match(shipped.stderr, /valid Whyfull license key/)
  assert.equal(shipped.stdout, "")
})

test("deactivate removes the key and keeps the trial count", async (t) => {
  const { config } = fixture(t)
  const nothing = await run(["deactivate"], config)
  assert.equal(nothing.code, 0)
  assert.match(nothing.stdout, /No license was active/)
  assert.equal(existsSync(licensePath(config)), false)

  mkdirSync(join(config, ".."), { recursive: true })
  writeFileSync(
    licensePath(config),
    JSON.stringify({
      usageDays: 5,
      firstUseDay: "2026-01-01",
      lastUseDay: "2026-01-05",
    })
  )
  await run(["activate", issue()], config)
  const removed = await run(["deactivate", "--json"], config)
  assert.equal(removed.code, 0)
  const report = JSON.parse(removed.stdout)
  assert.equal(report.desktop.licensed, false)
  assert.equal(report.desktop.usageDays, 5)
  assert.equal(JSON.parse(readFileSync(licensePath(config), "utf8")).key, null)
})

test("buy prints the purchase page and opens it only with --open", async (t) => {
  const { config } = fixture(t)
  const opened = []
  const openUrl = async (url) => void opened.push(url)
  const plain = await run(["buy"], config, { openUrl })
  assert.equal(plain.code, 0)
  assert.equal(plain.stdout, `${LICENSE_PAGES.buy}\n`)
  assert.deepEqual(opened, [])
  assert.equal((await run(["buy", "--open"], config, { openUrl })).code, 0)
  assert.deepEqual(opened, [LICENSE_PAGES.buy])
  const failed = await run(["buy", "--open"], config, {
    openUrl: async () => {
      throw new Error("Could not open your browser")
    },
  })
  assert.equal(failed.code, 1)
  assert.match(failed.stderr, /Could not open your browser/)
})

test("usage errors exit 2 and help documents the command", async (t) => {
  const { config } = fixture(t)
  for (const args of [
    ["frobnicate"],
    ["activate"],
    ["activate", "a", "b"],
    ["status", "extra"],
    ["status", "--bogus"],
    ["status", "--open"],
    ["buy", "--json"],
  ]) {
    const result = bin(args, config)
    assert.equal(result.code, 2, `${args.join(" ")}: ${result.stderr}`)
    assert.match(result.stderr, /^whyfull: /)
    assert.equal(result.stdout, "")
  }
  const help = bin(["--help"], config)
  assert.equal(help.code, 0)
  for (const word of [
    "status",
    "activate",
    "deactivate",
    "buy",
    "--json",
    "--open",
  ])
    assert.ok(help.stdout.includes(word), word)
  assert.ok(help.stdout.includes(`then ${LICENSE_PRICE} one-time`))
  assert.match(
    execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }),
    /whyfull license/
  )
  const status = bin(["status", "--json"], config)
  assert.equal(status.code, 0)
  assert.equal(JSON.parse(status.stdout).format, "whyfull-license")
  assert.equal(existsSync(licensePath(config)), false, "no trial day recorded")
})
