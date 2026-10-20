import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtempSync,
  realpathSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { request } from "node:http"
import { startViewer, scanFilesystem } from "../dist/index.mjs"

test("loopback capability rejects cross-site traffic, forged authentication and command injection", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "whyfull-security-")))
  const marker = join(root, "must-not-execute")
  const viewers = []
  try {
    writeFileSync(join(root, "data"), "untouched")
    const snapshot = await scanFilesystem({ root, workers: 1 })
    for (const name of ["first", "second"])
      viewers.push(
        await startViewer({
          root,
          snapshot,
          open: false,
          policyFile: join(root, `${name}.json`),
        })
      )
    const [url, other] = viewers.map((viewer) => new URL(viewer.url))
    assert.equal(viewers[0].server.address().address, "127.0.0.1")
    assert.notEqual(url.port, other.port)
    assert.match(url.hash.slice(1), /^[a-f0-9]{64}$/)
    assert.notEqual(url.hash, other.hash)
    const headers = { Authorization: `Bearer ${url.hash.slice(1)}` }
    const get = (path, extra = {}) =>
      fetch(`${url.origin}/api/${path}`, { headers: { ...headers, ...extra } })
    const post = (path, body, extra = {}) =>
      fetch(`${url.origin}/api/${path}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", ...extra },
        body: JSON.stringify(body),
      })

    for (const auth of [
      "",
      url.hash.slice(1),
      `Bearer ${other.hash.slice(1)}`,
      `Bearer ${"0".repeat(64)}`,
      `Basic ${url.hash.slice(1)}`,
    ]) {
      const denied = await get("status", { Authorization: auth })
      assert.equal(denied.status, 401)
      assert.deepEqual(await denied.json(), { error: "Unauthorized" })
      assert.equal(denied.headers.get("server"), null)
      assert.equal(denied.headers.get("x-powered-by"), null)
      assert.equal(denied.headers.get("access-control-allow-origin"), null)
    }
    for (const path of [
      `status?token=${url.hash.slice(1)}`,
      "diagnostics",
      "export",
      "report/locations",
    ]) {
      assert.equal(
        (
          await fetch(`${url.origin}/api/${path}`, {
            headers: { Cookie: `whyfull-token=${url.hash.slice(1)}` },
          })
        ).status,
        401
      )
    }
    for (const origin of [
      "https://attacker.example",
      "null",
      other.origin,
      url.origin.replace("127.0.0.1", "localhost"),
    ]) {
      assert.equal((await get("status", { Origin: origin })).status, 403)
    }
    for (const site of ["cross-site", "same-site", "none"]) {
      assert.equal(
        (
          await post(
            "diagnostics",
            { action: "run", id: "space" },
            { "Sec-Fetch-Site": site }
          )
        ).status,
        403
      )
    }
    const rawStatus = (extra) =>
      new Promise((resolve, reject) => {
        const req = request(
          `${url.origin}/api/status`,
          { headers: { ...headers, ...extra } },
          (res) => {
            res.resume()
            resolve(res.statusCode)
          }
        )
        req.on("error", reject)
        req.end()
      })
    assert.equal(await rawStatus({ "Sec-Fetch-Mode": "navigate" }), 403)
    assert.equal(await rawStatus({ "Sec-Fetch-Dest": "iframe" }), 403)
    assert.equal(await rawStatus({ Host: "rebinding.attacker.example" }), 403)
    const allowed = await get("status", {
      Origin: url.origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    })
    assert.equal(allowed.status, 200)
    assert.equal(
      allowed.headers.get("cross-origin-resource-policy"),
      "same-origin"
    )
    assert.equal(
      allowed.headers.get("cross-origin-opener-policy"),
      "same-origin"
    )
    assert.match(
      allowed.headers.get("content-security-policy"),
      /frame-ancestors 'none'/
    )
    assert.match(allowed.headers.get("referrer-policy"), /no-referrer/)
    assert.equal(
      (await get("status")).status,
      200,
      "native clients must still hold the session key"
    )
    const preflight = await fetch(`${url.origin}/api/diagnostics`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    })
    assert.equal(preflight.status, 403)
    assert.equal(preflight.headers.get("access-control-allow-origin"), null)

    const before = await (await get("status")).json()
    for (const path of [
      "diagnostics",
      "preferences",
      "policy",
      "mark",
      "finder",
      "report/action",
      "scan-root",
      "trash/preview",
      "trash/execute",
      "import",
    ]) {
      assert.equal(
        (
          await post(
            path,
            { action: "run", id: "space" },
            { Authorization: "" }
          )
        ).status,
        401,
        path
      )
    }
    for (const type of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
    ]) {
      assert.equal(
        (
          await post(
            "diagnostics",
            { action: "run", id: "space" },
            { "Content-Type": type }
          )
        ).status,
        415
      )
    }
    assert.equal(
      (await post("import", {}, { "Content-Type": "text/plain" })).status,
      415
    )
    assert.equal(
      (await fetch(`${url.origin}/api/diagnostics`, { method: "PUT", headers }))
        .status,
      405
    )
    for (const body of [
      null,
      [],
      "run space",
      { action: "run", id: `space; touch ${marker}` },
      {
        action: "run",
        id: "space",
        executable: "/bin/sh",
        args: ["-c", `touch ${marker}`],
      },
      {
        action: "run",
        id: "whyfull",
        options: {
          top: 0,
          exact: false,
          caches: false,
          worktrees: false,
          command: `touch ${marker}`,
        },
      },
    ]) {
      assert.equal((await post("diagnostics", body)).status, 400)
    }
    assert.equal(
      (await post("preferences", { padding: "é".repeat(9000) })).status,
      400,
      "limits count bytes, not just characters"
    )
    assert.equal(
      (await post("cleanup-mode", { mode: "trash" })).status,
      400,
      "the key cannot grant the missing CLI Trash capability"
    )
    const unchanged = await (await get("status")).json()
    assert.equal(unchanged.documentId, before.documentId)
    assert.equal(unchanged.viewer.minFileBytes, before.viewer.minFileBytes)
    assert.equal(unchanged.cleanup.mode, "demo")
    assert.equal(existsSync(marker), false)
    assert.deepEqual((await (await get("diagnostics")).json()).runs, [])
    assert.equal(
      (
        await post(
          "diagnostics",
          { action: "run", id: "space" },
          { "Content-Type": "application/json; charset=utf-8" }
        )
      ).status,
      200
    )
    for (let i = 0; i < 200; i++) {
      const state = await (await get("diagnostics")).json()
      if (!state.running) {
        assert.equal(state.runs[0].status, "complete")
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal((await (await get("diagnostics")).json()).running, false)
    assert.equal(existsSync(marker), false)
  } finally {
    await Promise.all(viewers.map((viewer) => viewer.close()))
    rmSync(root, { recursive: true, force: true })
  }
})
