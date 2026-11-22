import { test } from "node:test"
import assert from "node:assert/strict"
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildLegalPage,
  findPlaceholders,
  outputPath,
} from "../scripts/build-legal.mjs"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const documents = ["EULA.md", "LICENSE", "PRIVACY.md", "TRADEMARKS.md"]
const callout = 'class="wf-legal-callout"'

test("the generator is deterministic and the committed page is current", async () => {
  const first = await buildLegalPage()
  const second = await buildLegalPage()
  assert.equal(first, second)
  assert.equal(
    await readFile(outputPath, "utf8"),
    first,
    "legal/index.html is stale: run `pnpm --filter @whyfull/brochure legal`"
  )
})

test("every id is unique and the linked anchors exist", async () => {
  const html = await buildLegalPage()
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
  assert.deepEqual(
    ids.filter((id, index) => ids.indexOf(id) !== index),
    []
  )
  for (const id of [
    "main",
    "contact",
    "eula",
    "source-license",
    "privacy",
    "trademarks",
    "eula-21-contact",
    "eula-4-1-evaluation",
    "privacy-4-service-providers-processors",
  ])
    assert.ok(ids.includes(id), `missing #${id}`)
  assert.match(html, /<h3 id="eula-\d+-contact"><span id="contact"><\/span>/)
  for (const match of html.matchAll(/href="#([^"]+)"/g))
    assert.ok(ids.includes(match[1]), `broken link to #${match[1]}`)
})

test("all four documents are on the page", async () => {
  const html = await buildLegalPage()
  for (const sentence of [
    '<h2 id="eula-title">End User License Agreement</h2>',
    "The absence of technical enforcement is not permission.",
    "WE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,",
    '<a href="/recover/">whyfull.app/recover/</a>',
    "Whyfull Source-Available License",
    "No open source grant, now or later",
    '<h2 id="privacy-title">Privacy Notice</h2>',
    "<td><strong>Stripe</strong></td>",
    "The Whyfull CLI and desktop app collect nothing.",
    '<h2 id="trademarks-title">Trademark Policy</h2>',
    "Without our prior written permission, you may not:",
  ])
    assert.ok(
      html.replace(/\s+/g, " ").includes(sentence.replace(/\s+/g, " ")),
      `missing: ${sentence}`
    )
  // The Markdown draft notes are replaced by the page's own banner.
  assert.doesNotMatch(html, /needs lawyer review/)
  const eula = await readFile(join(root, "EULA.md"), "utf8")
  const effective = /^Version .*$/m.exec(eula)?.[0]
  assert.ok(effective)
  const escaped = effective.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  assert.match(
    html,
    new RegExp(`<p class="wf-legal-eyebrow">\\s*${escaped}\\s*</p>`)
  )
})

test("the draft banner shows only while placeholders remain", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "whyfull-legal-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const name of documents)
    await copyFile(join(root, name), join(directory, name))

  const draft = await buildLegalPage({ root: directory })
  assert.ok(draft.includes(callout))

  for (const name of documents) {
    const path = join(directory, name)
    const filled = (await readFile(path, "utf8"))
      .replace(/\[EFFECTIVE DATE\]/g, "1 January 2027")
      .replace(/\[[A-Z][A-Z0-9 /&.,_-]*\](?!\()/g, (token) =>
        token === "[BRACKETS]" ? token : "Filled In"
      )
    await writeFile(path, filled)
  }
  assert.deepEqual(
    findPlaceholders(
      (
        await Promise.all(
          documents.map((name) => readFile(join(directory, name), "utf8"))
        )
      ).join("\n")
    ),
    []
  )
  const final = await buildLegalPage({ root: directory })
  assert.ok(!final.includes(callout))
  assert.match(final, /Version 1\.0 · Effective 1 January 2027/)

  // One placeholder left anywhere brings the banner back.
  const trademarks = join(directory, "TRADEMARKS.md")
  await writeFile(
    trademarks,
    (await readFile(trademarks, "utf8")) + "\nContact [SUPPORT EMAIL].\n"
  )
  assert.ok((await buildLegalPage({ root: directory })).includes(callout))
})
