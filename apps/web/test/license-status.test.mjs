import test from "node:test"
import assert from "node:assert/strict"
import { licenseStatus, trialLabel } from "../src/lib/license-status.ts"

const base = {
  enabled: true,
  licensed: false,
  holder: null,
  licenseId: null,
  trialDays: 30,
  usageDays: 0,
  trialRemaining: 30,
  reminderDue: false,
  price: "$19",
  checkoutUrl: "https://whyfull.app/buy/",
}

test("trial labels count days of use", () => {
  assert.equal(
    trialLabel({ ...base, trialRemaining: 12 }),
    "Trial · 12 days left"
  )
  assert.equal(trialLabel({ ...base, trialRemaining: 1 }), "Trial · 1 day left")
  assert.equal(trialLabel({ ...base, trialRemaining: 0 }), "Trial ended")
})

test("licensed labels name the holder when known", () => {
  const licensed = { ...base, licensed: true, licenseId: "ord_1" }
  assert.equal(trialLabel(licensed), "Licensed")
  assert.equal(trialLabel({ ...licensed, holder: "Ada" }), "Licensed to Ada")
  assert.deepEqual(licenseStatus({ ...licensed, holder: "Ada" }), {
    title: "Licensed to Ada",
    detail: "License ord_1",
  })
})

test("an ended trial says the app keeps working", () => {
  const status = licenseStatus({ ...base, trialRemaining: 0, usageDays: 31 })
  assert.equal(status.title, "Trial ended")
  assert.match(status.detail, /keeps working/)
  assert.match(licenseStatus(base).detail, /\$19/)
})
