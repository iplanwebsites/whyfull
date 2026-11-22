import test from "node:test"
import assert from "node:assert/strict"
import {
  fetchViewer,
  viewerIsOffline,
  subscribeViewerConnection,
  ViewerOfflineError,
  VIEWER_OFFLINE_MESSAGE,
  isViewerOfflineError,
  QueryErrorTracker,
} from "../src/lib/viewer-connection.ts"

async function reset(t) {
  t.mock.method(globalThis, "fetch", async () => new Response("{}"))
  await fetchViewer("/api/status")
}

test("repeated failed polls produce one offline transition, then clear on recovery", async (t) => {
  await reset(t)
  const changes = []
  const unsubscribe = subscribeViewerConnection(() =>
    changes.push(viewerIsOffline())
  )
  t.after(unsubscribe)
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch")
  })
  for (let i = 0; i < 5; i++)
    await assert.rejects(fetchViewer("/api/status"), ViewerOfflineError)
  assert.deepEqual(changes, [true])
  assert.equal(viewerIsOffline(), true)
  await reset(t)
  await fetchViewer("/api/drives")
  assert.deepEqual(changes, [true, false])
  unsubscribe()
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch")
  })
  await assert.rejects(fetchViewer("/api/status"), ViewerOfflineError)
  assert.deepEqual(changes, [true, false])
  await reset(t)
})

test("cancelled requests do not create or clear an offline incident", async (t) => {
  await reset(t)
  const abort = new DOMException("Cancelled", "AbortError")
  t.mock.method(globalThis, "fetch", async () => {
    throw abort
  })
  await assert.rejects(fetchViewer("/api/status"), (e) => e === abort)
  assert.equal(viewerIsOffline(), false)
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch")
  })
  await assert.rejects(fetchViewer("/api/status"), ViewerOfflineError)
  t.mock.method(globalThis, "fetch", async () => {
    throw abort
  })
  await assert.rejects(fetchViewer("/api/status"), (e) => e === abort)
  assert.equal(viewerIsOffline(), true)
  await reset(t)
})

test("unavailable backend responses use the banner, while application errors remain regular errors", async (t) => {
  await reset(t)
  for (const status of [502, 503, 504]) {
    t.mock.method(
      globalThis,
      "fetch",
      async () => new Response("Unavailable", { status })
    )
    await assert.rejects(fetchViewer("/api/status"), ViewerOfflineError)
    assert.equal(viewerIsOffline(), true)
  }
  for (const status of [400, 401, 404]) {
    t.mock.method(
      globalThis,
      "fetch",
      async () => new Response("{}", { status })
    )
    assert.equal((await fetchViewer("/api/status")).status, status)
    assert.equal(viewerIsOffline(), false)
  }
})

test("offline errors are recognizable through existing action-error message paths", () => {
  const error = new ViewerOfflineError()
  assert.equal(isViewerOfflineError(error), true)
  assert.equal(isViewerOfflineError(error.message), true)
  assert.equal(isViewerOfflineError(String(error)), true)
  assert.equal(error.message, VIEWER_OFFLINE_MESSAGE)
  assert.equal(isViewerOfflineError(new Error("Cannot open directory")), false)
})

test("the connection wrapper retains the viewer's request security options", async (t) => {
  let observed
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    observed = init
    return new Response("{}")
  })
  const controller = new AbortController()
  await fetchViewer("/api/status", {
    signal: controller.signal,
    mode: "cors",
    credentials: "include",
    redirect: "follow",
    cache: "default",
  })
  assert.equal(observed.signal, controller.signal)
  assert.equal(observed.mode, "same-origin")
  assert.equal(observed.credentials, "omit")
  assert.equal(observed.redirect, "error")
  assert.equal(observed.cache, "no-store")
})

test("polling errors notify once until recovery, without silencing new failures", () => {
  const errors = new QueryErrorTracker()
  assert.equal(errors.shouldNotify("status", "Could not read report"), true)
  assert.equal(errors.shouldNotify("status", "Could not read report"), false)
  assert.equal(errors.shouldNotify("status", "Could not read report"), false)
  assert.equal(errors.shouldNotify("status", "Invalid authentication"), true)
  assert.equal(errors.shouldNotify("drives", "Could not read report"), true)
  errors.recovered("status")
  assert.equal(errors.shouldNotify("status", "Could not read report"), true)
  assert.equal(errors.shouldNotify("drives", "Could not read report"), false)
})
