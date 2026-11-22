import test from "node:test"
import assert from "node:assert/strict"
import {
  LICENSE_EVENT,
  SUCCESS_MESSAGE,
  licenseEventDetail,
  listenForLicense,
} from "../src/lib/license-events.ts"

test("license event details are validated", () => {
  assert.deepEqual(licenseEventDetail({ ok: true, message: "Licensed" }), {
    ok: true,
    message: "Licensed",
  })
  assert.deepEqual(licenseEventDetail({ ok: true }), {
    ok: true,
    message: SUCCESS_MESSAGE,
  })
  assert.equal(licenseEventDetail({ ok: false }).ok, false)
  assert.equal(licenseEventDetail({ ok: "yes" }), null)
  assert.equal(licenseEventDetail(null), null)
})

test("listeners receive events and a result sent before mounting", () => {
  const target = new EventTarget()
  target.__whyfullLicense = { ok: true, message: "Licensed to Ada" }
  const seen = []
  const stop = listenForLicense(target, (detail) => seen.push(detail))
  assert.deepEqual(seen, [{ ok: true, message: "Licensed to Ada" }])
  assert.equal(target.__whyfullLicense, undefined)
  target.__whyfullLicense = { ok: false, message: "Bad key" }
  target.dispatchEvent(
    new CustomEvent(LICENSE_EVENT, { detail: target.__whyfullLicense })
  )
  assert.deepEqual(seen.at(-1), { ok: false, message: "Bad key" })
  // The stash is consumed, so a later mount doesn't repeat it.
  assert.equal(target.__whyfullLicense, undefined)
  stop()
  target.dispatchEvent(new CustomEvent(LICENSE_EVENT, { detail: { ok: true } }))
  assert.equal(seen.length, 2)
})
