import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  realpathSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
import { Server } from "node:http"
import { Readable } from "node:stream"
import {
  loadKnowledge,
  updateKnowledge,
  knowledgePath,
  locationProposal,
  forPlatform,
  startViewer,
  scanFilesystem,
  TARGETS_RAW,
  validateViewerReport,
} from "../dist/index.mjs"

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "whyfull-knowledge-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, config: join(root, "settings", "config.json") }
}
function add(config, overrides = {}, scope = "computer") {
  return updateKnowledge(
    {
      action: "save-location",
      scope,
      location: {
        id: "models",
        name: "Models",
        path: "~/Models",
        ...overrides,
      },
    },
    config
  )
}

test("knowledge is private, persistent, scoped, and isolated from policy settings", (t) => {
  const { config } = fixture(t)
  assert.equal(loadKnowledge(config).revision, 0)
  add(config, { instructions: "Keep my offline models" }, "user")
  const next = add(config, {
    path: "/Volumes/Models",
    source: "agent",
    enabled: false,
  })
  assert.equal(next.locations.length, 1)
  assert.equal(next.locations[0].scope, "computer")
  assert.equal(next.locations[0].enabled, false)
  assert.equal(next.locations[0].tier, "DATA")
  assert.equal(next.user.locations[0].instructions, "Keep my offline models")
  assert.equal(
    forPlatform(process.platform, config).some(
      (item) => item.id === "local:models"
    ),
    false
  )
  const restored = updateKnowledge(
    { action: "remove-location", scope: "computer", id: "models" },
    config
  )
  assert.equal(restored.locations[0].scope, "user")
  assert.equal(restored.locations[0].enabled, true)
  if (process.platform !== "win32")
    assert.equal(statSync(knowledgePath(config)).mode & 0o777, 0o600)
  writeFileSync(
    config,
    JSON.stringify({ keep: ["/important"], viewer: { theme: "dark" } })
  )
  updateKnowledge(
    { action: "instructions", scope: "computer", instructions: "Work laptop" },
    config
  )
  assert.deepEqual(JSON.parse(readFileSync(config, "utf8")), {
    keep: ["/important"],
    viewer: { theme: "dark" },
  })
  assert.equal(
    loadKnowledge(config).computerSettings.instructions,
    "Work laptop"
  )
})

test("stale edits, invalid payloads, and concurrent writers cannot clobber knowledge", (t) => {
  const { config } = fixture(t)
  add(config)
  const before = readFileSync(knowledgePath(config), "utf8")
  assert.throws(
    () =>
      updateKnowledge(
        {
          action: "instructions",
          scope: "user",
          instructions: "stale",
          revision: 0,
        },
        config
      ),
    /changed elsewhere/
  )
  for (const location of [
    { id: "UPPERCASE" },
    { path: "relative/path" },
    { path: "/tmp/\nweird" },
    { name: "\x1b[31m" },
    { instructions: "\0" },
    { enabled: "yes" },
    { source: "unknown" },
    { tier: "SAFE" },
    { surprise: true },
  ])
    assert.throws(() => add(config, location))
  assert.equal(readFileSync(knowledgePath(config), "utf8"), before)
  writeFileSync(`${knowledgePath(config)}.lock`, "held")
  assert.throws(() => add(config), /being updated/)
  assert.equal(readFileSync(knowledgePath(config), "utf8"), before)
  rmSync(`${knowledgePath(config)}.lock`)
  writeFileSync(knowledgePath(config), "{ broken config")
  assert.throws(() => add(config))
  assert.equal(readFileSync(knowledgePath(config), "utf8"), "{ broken config")
})

test("profiles can retain locations for other operating systems without activating them", (t) => {
  const { config } = fixture(t)
  const otherPlatform = process.platform === "win32" ? "linux" : "win32"
  const path = otherPlatform === "win32" ? "D:\\Models\\offline" : "/mnt/models"
  const state = add(config, { platform: otherPlatform, path }, "user")
  assert.equal(state.user.locations[0].path, path)
  assert.equal(state.locations.length, 0)
  assert.equal(loadKnowledge(config).user.locations[0].platform, otherPlatform)
  add(config, { path: "~/Models", platform: process.platform }, "user")
  add(config, { platform: otherPlatform, path, enabled: false }, "computer")
  const current = loadKnowledge(config)
  assert.equal(current.locations.length, 1)
  assert.equal(current.locations[0].scope, "user")
  assert.equal(current.locations[0].platform, process.platform)
  assert.equal(current.locations[0].enabled, true)
})

test("creating a saved place cannot overwrite an existing ID in that scope", (t) => {
  const { config } = fixture(t)
  const previous = add(config, { instructions: "Preserve my notes" })
  const create = {
    action: "save-location",
    scope: "computer",
    createOnly: true,
    revision: previous.revision,
    location: { id: "models", name: "Different models", path: "~/Other" },
  }
  assert.throws(() => updateKnowledge(create, config), /already exists/)
  assert.deepEqual(loadKnowledge(config), previous)
  const next = updateKnowledge({ ...create, scope: "user" }, config)
  assert.equal(next.user.locations[0].path, "~/Other")
  assert.equal(
    next.computerSettings.locations[0].instructions,
    "Preserve my notes"
  )
  assert.equal(next.locations[0].scope, "computer")
})

test("public contributions require explicit portable fields and exclude all local context", (t) => {
  const { root, config } = fixture(t)
  add(config, {
    name: "Private customer name",
    path: root,
    instructions: "SECRET per-location notes",
    tier: "AUTO",
  })
  updateKnowledge(
    {
      action: "instructions",
      scope: "user",
      instructions: "SECRET global instructions",
    },
    config
  )
  const input = {
    id: "models",
    name: "Example models",
    path: "~/.cache/example",
    hint: "Inspect offline requirements before removing downloads.",
  }
  const proposal = locationProposal(input, config)
  assert.equal(proposal.targets[0].tier, "JUDGEMENT")
  assert.deepEqual(proposal.targets[0].paths[process.platform], [input.path])
  assert.doesNotMatch(
    JSON.stringify(proposal),
    /SECRET|Private customer|computerSettings|updatedAt|resolvedPath/
  )
  assert.equal(JSON.stringify(proposal).includes(root), false)
  const renamed = locationProposal(
    { ...input, publicId: "example-tool-cache" },
    config
  )
  assert.equal(renamed.targets[0].id, "example-tool-cache")
  assert.equal(JSON.stringify(renamed).includes('"id":"models"'), false)
  for (const publicId of ["", "PRIVATE ID", "../private", "x".repeat(81)])
    assert.throws(
      () => locationProposal({ ...input, publicId }, config),
      /[Ii][Dd]/
    )
  for (const path of [
    root,
    "relative/cache",
    "~/../private",
    "$HOME/../../secret",
  ])
    assert.throws(
      () => locationProposal({ ...input, path }, config),
      /Public paths/
    )
  assert.throws(() => locationProposal({ id: "models" }, config), /Invalid/)
  assert.throws(
    () => locationProposal({ ...input, id: "missing" }, config),
    /saved location/
  )
})

test("personal entries replace matching known paths without duplicating targets", (t) => {
  const { config } = fixture(t)
  const known = forPlatform(process.platform, config).find((item) =>
    item.candidates.some(Boolean)
  )
  assert.ok(known)
  const path = known.candidates.find(Boolean)
  add(config, { path, instructions: "This location is needed offline" })
  const targets = forPlatform(process.platform, config)
  assert.equal(
    targets
      .flatMap((target) => target.candidates)
      .filter((candidate) => candidate === path).length,
    1
  )
  assert.equal(
    targets.find((item) => item.id === "local:models").hint,
    "This location is needed offline"
  )
})

const cli = resolve("dist/cli.mjs")
function run(root, args, more = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      WHYFULL_CONFIG_DIR: join(root, "settings"),
      WHYFULL_MACHINE_ID: "fixture-machine",
      NO_COLOR: "1",
    },
    ...more,
  })
}
test("XDG support preserves existing configuration and explicit directory overrides", (t) => {
  const { root } = fixture(t)
  const env = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    WHYFULL_CONFIG_DIR: "",
    XDG_CONFIG_HOME: join(root, "xdg"),
  }
  const read = () =>
    JSON.parse(run(root, ["locations", "list", "--json"], { env })).file
  assert.equal(read(), join(root, "xdg", "whyfull", "knowledge.json"))
  mkdirSync(join(root, ".config", "whyfull"), { recursive: true })
  assert.equal(read(), join(root, ".config", "whyfull", "knowledge.json"))
  env.WHYFULL_CONFIG_DIR = join(root, "explicit")
  assert.equal(read(), join(root, "explicit", "knowledge.json"))
})
test("CLI edits persist across processes, computer identities, and JSON reports", (t) => {
  const { root, config } = fixture(t)
  add(
    config,
    {
      platform: process.platform === "win32" ? "linux" : "win32",
      path: "~/Models",
    },
    "user"
  )
  mkdirSync(join(root, "models"))
  writeFileSync(join(root, "models", "data"), Buffer.alloc(65536))
  run(root, [
    "locations",
    "add",
    "./models",
    "--id",
    "models",
    "--scope",
    "user",
    "--instructions",
    "Preserve downloaded models",
  ])
  assert.equal(
    loadKnowledge(config).user.locations[0].platform,
    process.platform
  )
  run(root, [
    "locations",
    "add",
    "./models",
    "--id",
    "models",
    "--source",
    "agent",
    "--name",
    "Offline models",
  ])
  run(root, [
    "locations",
    "add",
    "./models",
    "--id",
    "models",
    "--instructions",
    "Keep all local models",
  ])
  const view = JSON.parse(run(root, ["locations", "--json"]))
  assert.equal(view.locations[0].name, "Offline models")
  assert.equal(view.locations[0].source, "agent")
  const proposal = JSON.parse(
    run(root, [
      "locations",
      "export",
      "models",
      "--public-id",
      "example-model-cache",
      "--name",
      "Example models",
      "--path-template",
      "~/.cache/example-models",
      "--hint",
      "Check offline requirements first.",
    ])
  )
  assert.equal(proposal.targets[0].id, "example-model-cache")
  assert.doesNotMatch(
    JSON.stringify(proposal),
    /Keep all local models|Offline models/
  )
  run(root, [
    "instructions",
    "set",
    "--scope",
    "user",
    "--text",
    "Prefer app cleanup",
  ])
  const note = join(root, "notes.txt")
  writeFileSync(note, "No downloads while offline")
  run(root, ["instructions", "set", "--file", note])
  const report = JSON.parse(
    run(root, ["--json", "--no-worktrees", "--no-cache-scan", "--no-drill"])
  )
  assert.equal(
    report.targets.find((item) => item.id === "local:models").hint,
    "Keep all local models"
  )
  assert.deepEqual(report.localContext, {
    userInstructions: "Prefer app cleanup",
    computerInstructions: "No downloads while offline",
  })
  const other = JSON.parse(
    run(root, ["locations", "list", "--json"], {
      env: {
        ...process.env,
        HOME: root,
        WHYFULL_CONFIG_DIR: join(root, "settings"),
        WHYFULL_MACHINE_ID: "another-machine",
      },
    })
  )
  assert.equal(other.locations[0].scope, "user")
  assert.equal(other.computerSettings.instructions, "")
  assert.equal(other.user.instructions, "Prefer app cleanup")
  run(root, ["instructions", "set", "--text", ""])
  assert.equal(
    JSON.parse(run(root, ["instructions", "show", "--json"])).computerSettings
      .instructions,
    ""
  )
})

test("idiomatic scan accepts a folder and preserves legacy scan output", (t) => {
  const { root } = fixture(t)
  const folder = join(root, "project with spaces")
  mkdirSync(folder)
  writeFileSync(join(folder, "data"), "hello")
  const report = JSON.parse(
    run(root, ["scan", folder, "--json", "--no-cache", "--workers", "1"])
  )
  assert.equal(report.format, "whyfull-disk")
  assert.equal(report.root, folder)
  assert.equal(report.files, 1)
  const current = JSON.parse(
    run(root, ["scan", "--json", "--no-cache", "--workers", "1"], {
      cwd: folder,
    })
  )
  assert.equal(current.root, folder)
  for (const args of [
    ["locations", "add", folder, "--id", "models", "--scope", "global"],
    ["locations", "list", "--name", "ignored"],
    ["instructions", "set", "--text", "x", "--revision", "oops"],
    ["--json", "--config", ""],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      env: { ...process.env, WHYFULL_CONFIG_DIR: join(root, "settings") },
    })
    assert.equal(result.status, 2)
    assert.equal(result.stdout, "")
  }
})

test("in-memory viewer requests share knowledge, refresh suggestions, and validate scan folders", async (t) => {
  // Exercise the real request handler without depending on network permissions.
  // Existing viewer-security/runner tests cover the actual HTTP transport.
  t.mock.method(Server.prototype, "listen", function (_port, _host, ready) {
    ready()
    return this
  })
  t.mock.method(Server.prototype, "address", () => ({
    address: "127.0.0.1",
    family: "IPv4",
    port: 43123,
  }))
  t.mock.method(Server.prototype, "close", function (done) {
    done()
    return this
  })
  const { root, config } = fixture(t)
  const data = join(root, "data"),
    models = join(data, "models")
  mkdirSync(models, { recursive: true })
  writeFileSync(join(models, "data"), Buffer.alloc(65536))
  const snapshot = await scanFilesystem({ root: data, workers: 1 })
  const viewer = await startViewer({
    root: data,
    snapshot,
    workers: 1,
    open: false,
    cache: false,
    policyFile: config,
    drives: () => [],
  })
  t.after(() => viewer.close())
  const url = new URL(viewer.url)
  const headers = {
    host: url.host,
    authorization: `Bearer ${url.hash.slice(1)}`,
    "content-type": "application/json",
  }
  const request = (path, options = {}) =>
    new Promise((resolve, reject) => {
      const req = Readable.from(options.body ? [Buffer.from(options.body)] : [])
      req.method = options.method ?? "GET"
      req.url = `/api/${path}`
      req.headers = options.headers ?? headers
      let status = 200
      const res = {
        headersSent: false,
        setHeader() {},
        writeHead(code) {
          status = code
          this.headersSent = true
        },
        end(value) {
          resolve({ status, json: async () => JSON.parse(value) })
        },
        destroy() {
          reject(new Error("Response destroyed"))
        },
      }
      viewer.server.emit("request", req, res)
    })
  const get = async (path) => (await request(path)).json()
  const post = (path, body) =>
    request(path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  assert.equal(
    (await request("knowledge", { headers: { host: url.host } })).status,
    401
  )
  assert.equal((await get("knowledge")).revision, 0)
  assert.equal(
    (
      await post("knowledge", {
        action: "save-location",
        scope: "computer",
        revision: 0,
        location: {
          id: "models",
          name: "My models",
          path: models,
          instructions: "Keep these models",
        },
      })
    ).status,
    200
  )
  let analysis = await get("analysis")
  assert.throws(
    () =>
      validateViewerReport({
        ...analysis.report,
        localContext: { userInstructions: {}, computerInstructions: "" },
      }),
    /Invalid personal guidance/
  )
  assert.equal(
    analysis.report.targets.find((target) => target.id === "local:models").hint,
    "Keep these models"
  )
  assert.equal(
    (
      await post("knowledge", {
        action: "instructions",
        scope: "user",
        instructions: "stale",
        revision: 0,
      })
    ).status,
    400
  )
  updateKnowledge(
    {
      action: "instructions",
      scope: "computer",
      instructions: "Offline computer",
    },
    config
  )
  analysis = await get("analysis")
  assert.equal(
    analysis.report.localContext.computerInstructions,
    "Offline computer"
  )
  assert.equal((await post("scan-root", { root: models })).status, 200)
  assert.equal((await post("scan-path", { root: "relative" })).status, 400)
  assert.equal(
    (await post("scan-path", { root: join(models, "data") })).status,
    400
  )
  assert.equal((await post("scan-path", { root: data })).status, 200)
  const other = join(root, "another-folder")
  mkdirSync(other)
  writeFileSync(join(other, "file"), "scan this folder")
  assert.equal((await post("scan-path", { root: other })).status, 200)
  let current
  for (let attempt = 0; attempt < 100; attempt++) {
    current = await get("status")
    if (current.status === "complete") break
    await new Promise((done) => setTimeout(done, 10))
  }
  assert.equal(current.status, "complete")
  assert.equal(current.root, other)
  assert.equal(current.files, 1)
  assert.equal(
    (
      await post("knowledge", {
        action: "instructions",
        scope: "user",
        instructions: "x".repeat(24000),
      })
    ).status,
    200
  )
  assert.equal((await get("knowledge")).user.instructions.length, 24000)
  assert.equal(
    (await post("scan-root", { root: join(root, "unlisted") })).status,
    400
  )
})

test("community registry has unique IDs and portable reviewable definitions", () => {
  const registry = JSON.parse(
    readFileSync(
      new URL("../src/community-locations.json", import.meta.url),
      "utf8"
    )
  )
  const ids = new Set(TARGETS_RAW.map((item) => item.id))
  assert.deepEqual(Object.keys(registry), ["targets"])
  assert.ok(Array.isArray(registry.targets))
  for (const target of registry.targets) {
    assert.match(target.id, /^[a-z0-9][a-z0-9-]*$/)
    assert.equal(ids.has(target.id), false, `Duplicate target: ${target.id}`)
    ids.add(target.id)
    for (const field of ["label", "group", "hint"])
      assert.ok(typeof target[field] === "string" && target[field].trim())
    assert.ok(
      ["AUTO", "REBUILD", "JUDGEMENT", "APP", "DATA"].includes(target.tier)
    )
    assert.ok(Object.values(target.paths).flat().length > 0)
    for (const platform of ["darwin", "linux", "win32"]) {
      assert.ok(Array.isArray(target.paths[platform]))
      for (const path of target.paths[platform]) {
        assert.match(path, /^(~\/|\$[A-Z_][A-Z0-9_]*\/)/)
        assert.equal(path.split(/[\\/]/).includes(".."), false)
      }
    }
  }
})
