import { test } from "node:test"
import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Server } from "node:http"
import { Readable } from "node:stream"
import {
  DesktopLicense,
  encodeLicensePayload,
  extractLicenseKey,
  licensePath,
  verifyLicenseKey,
  LICENSE_PUBLIC_KEY,
  TRIAL_DAYS,
  LICENSE_PAGES,
  licensePageUrl,
  CLI_LICENSE_NOTICE,
  startViewer,
  scanFilesystem,
} from "../dist/index.mjs"

const pair = generateKeyPairSync("ed25519")
const publicKey = pair.publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64")
function issue(fields = {}, privateKey = pair.privateKey) {
  const body = encodeLicensePayload({
    v: 1,
    product: "whyfull-desktop",
    id: "ORDER-1",
    name: "Ada",
    issued: "2026-11-22",
    ...fields,
  })
  return `WHYFULL-${body}.${sign(null, Buffer.from(body), privateKey).toString("base64url")}`
}
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "whyfull-license-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, config: join(root, "settings", "config.json") }
}
const day = (n) => new Date(2026, 0, 1 + n, 12)

test("license keys verify offline and reject tampering", () => {
  const key = issue()
  assert.equal(verifyLicenseKey(key, publicKey)?.name, "Ada")
  assert.equal(verifyLicenseKey(key), null, "test keys fail the shipped key")
  assert.equal(typeof LICENSE_PUBLIC_KEY, "string")
  const other = generateKeyPairSync("ed25519").privateKey
  assert.equal(verifyLicenseKey(issue({}, other), publicKey), null)
  const [body, signature] = key.slice(8).split(".")
  const forged = encodeLicensePayload({
    ...JSON.parse(Buffer.from(body, "base64url")),
    name: "Mallory",
  })
  assert.equal(
    verifyLicenseKey(`WHYFULL-${forged}.${signature}`, publicKey),
    null
  )
  assert.equal(verifyLicenseKey(issue({ product: "other" }), publicKey), null)
  assert.equal(verifyLicenseKey("WHYFULL-abc", publicKey), null)
})

test("pasted purchase links and wrapped text yield the key", () => {
  const key = issue()
  assert.equal(
    extractLicenseKey(`https://whyfull.app/activate#key=${key}`),
    key
  )
  assert.equal(
    extractLicenseKey(`  ${key.slice(0, 30)}\n  ${key.slice(30)}  `),
    key
  )
  assert.equal(extractLicenseKey("no key here"), null)
})

test("only fixed whyfull.app pages can be opened", () => {
  assert.deepEqual(Object.keys(LICENSE_PAGES).sort(), [
    "buy",
    "legal",
    "recover",
  ])
  for (const url of Object.values(LICENSE_PAGES))
    assert.match(url, /^https:\/\/whyfull\.app\/[a-z]+\/$/)
  assert.equal(licensePageUrl("recover"), "https://whyfull.app/recover/")
  for (const page of [
    "toString",
    "__proto__",
    "constructor",
    "https://example.com/",
    "",
    undefined,
    null,
    ["buy"],
  ])
    assert.equal(licensePageUrl(page), null, String(page))
  assert.match(CLI_LICENSE_NOTICE, /Free for command-line use/)
  assert.ok(CLI_LICENSE_NOTICE.includes(LICENSE_PAGES.legal))
})

test("the trial counts distinct days of use and reminds at most daily", (t) => {
  const { config } = fixture(t)
  let now = day(0)
  const license = new DesktopLicense({
    policyFile: config,
    publicKey,
    clock: () => now,
  })
  assert.equal(license.status().usageDays, 0)
  license.recordUse()
  license.recordUse()
  assert.equal(license.status().usageDays, 1, "same day counts once")
  assert.equal(license.status().trialRemaining, TRIAL_DAYS - 1)
  for (let n = 1; n < TRIAL_DAYS; n++) {
    now = day(n * 3) // gaps between uses do not consume the trial
    license.recordUse()
  }
  let view = license.status()
  assert.equal(view.usageDays, TRIAL_DAYS)
  assert.equal(view.trialRemaining, 0)
  assert.equal(view.reminderDue, true)
  assert.equal(license.reminded().reminderDue, false)
  now = day(TRIAL_DAYS * 3 + 1)
  license.recordUse()
  assert.equal(license.status().reminderDue, true, "due again the next day")

  assert.throws(() => license.activate("WHYFULL-nope.nope"), /valid Whyfull/)
  view = license.activate(`Your key: ${issue()}`)
  assert.equal(view.licensed, true)
  assert.equal(view.holder, "Ada")
  assert.equal(view.reminderDue, false)
  const saved = JSON.parse(readFileSync(licensePath(config), "utf8"))
  assert.equal(saved.usageDays, TRIAL_DAYS + 1)
  assert.equal(license.deactivate().licensed, false)
})

test("a damaged license file resets quietly instead of failing", (t) => {
  const { config } = fixture(t)
  mkdirSync(join(config, ".."), { recursive: true })
  writeFileSync(licensePath(config), "{not json")
  const license = new DesktopLicense({ policyFile: config, publicKey })
  assert.equal(license.recordUse().usageDays, 1)
})

test("only viewers started by the desktop app expose license state", async (t) => {
  t.mock.method(Server.prototype, "listen", function (_port, _host, ready) {
    ready()
    return this
  })
  t.mock.method(Server.prototype, "address", () => ({
    address: "127.0.0.1",
    family: "IPv4",
    port: 43124,
  }))
  t.mock.method(Server.prototype, "close", function (done) {
    done()
    return this
  })
  const { root, config } = fixture(t)
  const data = join(root, "data")
  mkdirSync(data, { recursive: true })
  const snapshot = await scanFilesystem({ root: data, workers: 1 })
  async function open(license) {
    const viewer = await startViewer({
      root: data,
      snapshot,
      workers: 1,
      open: false,
      cache: false,
      policyFile: config,
      drives: () => [],
      license,
    })
    t.after(() => viewer.close())
    const url = new URL(viewer.url)
    const headers = {
      host: url.host,
      authorization: `Bearer ${url.hash.slice(1)}`,
      "content-type": "application/json",
    }
    return (path, body) =>
      new Promise((resolve, reject) => {
        const req = Readable.from(
          body ? [Buffer.from(JSON.stringify(body))] : []
        )
        req.method = body ? "POST" : "GET"
        req.url = `/api/${path}`
        req.headers = headers
        let status = 200
        viewer.server.emit("request", req, {
          headersSent: false,
          setHeader() {},
          writeHead(code) {
            status = code
            this.headersSent = true
          },
          end(value) {
            resolve({ status, body: JSON.parse(value) })
          },
          destroy() {
            reject(new Error("Response destroyed"))
          },
        })
      })
  }
  const cli = await open(undefined)
  assert.deepEqual((await cli("license")).body, { enabled: false })
  assert.equal((await cli("license", { action: "reminded" })).status, 404)

  const opened = []
  const desktop = await open({
    publicKey,
    openUrl: async (url) => void opened.push(url),
  })
  const state = (await desktop("license")).body
  assert.equal(state.enabled, true)
  assert.equal(state.usageDays, 1, "opening the desktop app records a use")
  assert.equal(state.licensed, false)
  await desktop("license", { action: "checkout" })
  assert.deepEqual(opened, [state.checkoutUrl], "checkout still opens buy")
  for (const page of ["buy", "recover", "legal"])
    assert.equal(
      (await desktop("license", { action: "open", page })).body.opened,
      true
    )
  assert.deepEqual(opened.slice(1), [
    LICENSE_PAGES.buy,
    LICENSE_PAGES.recover,
    LICENSE_PAGES.legal,
  ])
  for (const page of ["https://example.com/", "toString", undefined])
    assert.ok(
      (await desktop("license", { action: "open", page })).status >= 400,
      `refuses ${page}`
    )
  assert.equal(opened.length, 4, "nothing else was opened")
  assert.equal(
    (await cli("license", { action: "open", page: "buy" })).status,
    404
  )
  assert.equal(
    (await desktop("license", { action: "activate", key: "bad" })).status >=
      400,
    true
  )
  const active = await desktop("license", { action: "activate", key: issue() })
  assert.equal(active.body.licensed, true)
})
