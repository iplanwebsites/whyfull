// Website pricing and license copy must match the shared licensing module the
// CLI and desktop app use (packages/whyfull/src/license.ts, built to dist).
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  LICENSE_PAGES,
  LICENSE_PRICE,
  TRIAL_DAYS,
} from "../../../packages/whyfull/dist/index.mjs"

const page = async (/** @type {string} */ path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8")
/** Visible text with tags removed and whitespace collapsed. */
const text = (/** @type {string} */ html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
const amount = LICENSE_PRICE.replace(/^\$/, "")
const paths = Object.fromEntries(
  Object.entries(LICENSE_PAGES).map(([name, url]) => [
    name,
    new URL(url).pathname,
  ])
)
function section(
  /** @type {string} */ html,
  /** @type {string} */ start,
  /** @type {string} */ end
) {
  const from = html.indexOf(start)
  const to = html.indexOf(end, from + 1)
  assert.ok(from !== -1 && to !== -1, `section ${start}…${end}`)
  return html.slice(from, to)
}
/**
 * Every dollar price and trial length on the page matches the module. Zero
 * amounts (the free CLI, liability caps) are not prices.
 */
function assertOnlyCurrentTerms(
  /** @type {string} */ copy,
  /** @type {string} */ label
) {
  for (const [, value] of copy.matchAll(/\$([1-9]\d*)\b/g))
    assert.equal(`$${value}`, LICENSE_PRICE, `${label}: price $${value}`)
  for (const [, value] of copy.matchAll(/\b([1-9]\d*) \$ US/g))
    assert.equal(value, amount, `${label}: price ${value} $ US`)
  const trial =
    /(\d+)(?:-day (?:free )?(?:app )?trial| days of use| Days of Use| jours d’utilisation| Jours d’utilisation)/gi
  for (const [, value] of copy.matchAll(trial))
    assert.equal(Number(value), TRIAL_DAYS, `${label}: trial ${value}`)
}

test("license pages are whyfull.app paths the site serves", () => {
  assert.deepEqual(paths, {
    buy: "/buy/",
    recover: "/recover/",
    legal: "/legal/",
  })
  for (const url of Object.values(LICENSE_PAGES))
    assert.equal(new URL(url).origin, "https://whyfull.app")
})

test("home pricing section and FAQ match the licensing module", async () => {
  const html = await page("index.html")
  const pricing = section(html, 'id="pricing"', 'id="faq"')
  const copy = text(pricing)
  assert.ok(copy.includes(`${LICENSE_PRICE} one-time`), "price")
  assert.ok(copy.includes(`Free ${TRIAL_DAYS}-day trial`), "trial")
  assert.ok(copy.includes(`Buy Whyfull · ${LICENSE_PRICE}`), "buy button")
  for (const path of Object.values(paths))
    assert.ok(pricing.includes(`href="${path}"`), `pricing links ${path}`)

  const faq = text(section(html, 'id="faq"', "</section>"))
  assert.ok(faq.includes(`${LICENSE_PRICE} keeps it going`), "FAQ price")
  assert.ok(faq.includes("The CLI is free for everyone"), "FAQ free CLI")

  // Structured data carries the same price and pages.
  assert.ok(html.includes(`"license": "${LICENSE_PAGES.legal}"`))
  assert.match(
    html,
    new RegExp(
      `"price": "${amount}",\\s*"priceCurrency": "USD",\\s*"url": "${LICENSE_PAGES.buy}"`
    )
  )
  assert.ok(
    text(html).includes(`Free CLI. ${TRIAL_DAYS}-day trial for the app.`)
  )
  assertOnlyCurrentTerms(text(html), "home")
  assertOnlyCurrentTerms(html, "home html")
})

test("download page note matches the licensing module", async () => {
  const html = await page("download/index.html")
  const copy = text(html)
  assert.ok(
    copy.includes(
      `Desktop app: free for ${TRIAL_DAYS} days of use, then a ${LICENSE_PRICE}`
    ),
    "trial note"
  )
  assert.ok(copy.includes("The command line stays free."))
  assert.ok(copy.includes(`Free CLI · ${TRIAL_DAYS}-day app trial`))
  assert.ok(copy.includes(`Buy Whyfull · ${LICENSE_PRICE}`))
  for (const path of Object.values(paths))
    assert.ok(html.includes(`href="${path}"`), `download links ${path}`)
  assertOnlyCurrentTerms(copy, "download")
  assertOnlyCurrentTerms(html, "download html")
})

test("both legal pages state the EULA price and evaluation period", async () => {
  const en = await page("legal/index.html")
  const enCopy = text(en)
  assert.ok(enCopy.includes(`evaluation for ${TRIAL_DAYS} Days of Use`))
  assert.ok(enCopy.includes(`After ${TRIAL_DAYS} days of use`))
  assert.ok(enCopy.includes(`${LICENSE_PRICE} USD, once`))
  assert.ok(enCopy.includes(`A Desktop App license costs ${LICENSE_PRICE} USD`))
  assert.ok(enCopy.includes(`then ${LICENSE_PRICE} once`))
  assert.ok(en.includes(`<link rel="canonical" href="${LICENSE_PAGES.legal}"`))
  assert.ok(en.includes(`href="${paths.recover}"`))
  assertOnlyCurrentTerms(en, "legal")

  const fr = await page("legal/fr/index.html")
  const frCopy = text(fr)
  assert.ok(frCopy.includes(`pendant ${TRIAL_DAYS} Jours d’utilisation`))
  assert.ok(frCopy.includes(`Après ${TRIAL_DAYS} jours d’utilisation`))
  assert.ok(frCopy.includes(`${amount} $ US, une seule fois`))
  assert.ok(fr.includes(`href="${paths.legal}"`))
  assert.ok(fr.includes(`href="${paths.recover}"`))
  assertOnlyCurrentTerms(fr, "legal fr")
})

test("checkout text and release notes match the licensing module", async () => {
  const stripe = await page("worker/stripe.ts")
  assert.ok(stripe.includes(`whyfull.app${paths.legal}`), "checkout terms link")
  for (const notes of [
    "../desktop/release-notes-stable.md",
    "../desktop/release-notes-preview.md",
  ]) {
    const body = await page(notes)
    assert.ok(body.includes(`${TRIAL_DAYS} days of use`), notes)
    assert.ok(body.includes(`${LICENSE_PRICE} one-time license`), notes)
    assert.ok(body.includes(LICENSE_PAGES.buy), notes)
    assert.ok(body.includes(LICENSE_PAGES.legal), notes)
    for (const [price] of body.matchAll(/\$\d+/g))
      assert.equal(price, LICENSE_PRICE, notes)
  }
})
