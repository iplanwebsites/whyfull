import { test } from "node:test"
import assert from "node:assert/strict"
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildFrenchLegalPage,
  buildLegalPage,
  findPlaceholders,
  frenchOutputPath,
  outputPath,
  sourceDocuments as documents,
} from "../scripts/build-legal.mjs"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const callout = 'class="wf-legal-callout"'
const flat = (/** @type {string} */ text) => text.replace(/\s+/g, " ")

/** @param {string} html */
function assertAnchors(html) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
  assert.deepEqual(
    ids.filter((id, index) => ids.indexOf(id) !== index),
    []
  )
  for (const match of html.matchAll(/href="#([^"]+)"/g))
    assert.ok(ids.includes(match[1]), `broken link to #${match[1]}`)
  return ids
}

test("the generator is deterministic and the committed pages are current", async () => {
  for (const [build, path] of [
    [buildLegalPage, outputPath],
    [buildFrenchLegalPage, frenchOutputPath],
  ]) {
    const first = await build()
    assert.equal(first, await build())
    assert.equal(
      await readFile(path, "utf8"),
      first,
      `${path} is stale: run \`pnpm --filter @whyfull/brochure legal\``
    )
  }
})

test("every id is unique and the linked anchors exist", async () => {
  const html = await buildLegalPage()
  const ids = assertAnchors(html)
  for (const id of [
    "main",
    "contact",
    "eula",
    "source-license",
    "privacy",
    "trademarks",
    "eula-21-contact",
    "eula-4-1-evaluation",
    "privacy-4-service-providers",
    "eula-5-3-refunds",
  ])
    assert.ok(ids.includes(id), `missing #${id}`)
  assert.match(html, /<h3 id="eula-\d+-contact"><span id="contact"><\/span>/)
})

test("the French page has the French EULA and privacy notice", async () => {
  const html = await buildFrenchLegalPage()
  assert.match(html, /<html lang="fr-CA">/)
  const ids = assertAnchors(html)
  for (const id of [
    "main",
    "contact",
    "clu",
    "licence-source",
    "confidentialite",
    "marques",
    "clu-21-nous-joindre",
    "clu-4-1-evaluation",
    "clu-5-3-remboursements",
    "confidentialite-1-responsable",
  ])
    assert.ok(ids.includes(id), `missing #${id}`)
  assert.match(
    html,
    /<h3 id="clu-\d+-nous-joindre">\s*<span id="contact"><\/span>/
  )
  for (const sentence of [
    '<h2 id="clu-title">Contrat de licence d’utilisateur final</h2>',
    "L’absence de contrôle technique n’est pas une permission.",
    "la version française prévaut pour les consommateurs du Québec",
    '<h2 id="confidentialite-title">Avis de confidentialité</h2>',
    "personne responsable de la protection des renseignements personnels",
    "<td><strong>Resend</strong> (sous-traitant)</td>",
    // French typography: a non-breaking space before a colon.
    "Courriel&nbsp;: support@whyfull.app",
  ])
    assert.ok(flat(html).includes(flat(sentence)), `missing: ${sentence}`)
  assert.doesNotMatch(html, /doit être révisée par un avocat/)
  assert.doesNotMatch(html, /needs lawyer review/)
})

test("the English and French pages link to each other", async () => {
  const english = await buildLegalPage()
  const french = await buildFrenchLegalPage()
  for (const html of [english, french]) {
    assert.match(
      html,
      /hreflang="fr-CA"\s+href="https:\/\/whyfull\.app\/legal\/fr\/"/
    )
    assert.match(html, /hreflang="en"\s+href="https:\/\/whyfull\.app\/legal\/"/)
  }
  assert.match(english, /<a href="\/legal\/fr\/" hreflang="fr-CA"/)
  assert.match(french, /<a href="\/legal\/" hreflang="en"/)
  assert.match(
    french,
    /<link\s+rel="canonical"\s+href="https:\/\/whyfull\.app\/legal\/fr\/"/
  )
})

test("both language versions say which one prevails", async () => {
  const [eula, eulaFr, privacy, privacyFr] = await Promise.all(
    ["EULA.md", "EULA.fr.md", "PRIVACY.md", "PRIVACY.fr.md"].map((name) =>
      readFile(join(root, name), "utf8")
    )
  )
  for (const text of [eula, privacy])
    assert.match(flat(text), /the French version prevails/)
  for (const text of [eulaFr, privacyFr])
    assert.match(flat(text), /la version française prévaut/)
  // The French EULA keeps the English numbering, section by section.
  const numbers = (/** @type {string} */ text) =>
    [...text.matchAll(/^#{2,3} (\d+(?:\.\d+)?)\./gm)].map((m) => m[1])
  assert.deepEqual(numbers(eulaFr), numbers(eula))
  assert.deepEqual(numbers(privacyFr), numbers(privacy))
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
    "<td><strong>Stripe</strong> (independent)</td>",
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
  assert.ok((await buildFrenchLegalPage({ root: directory })).includes(callout))

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
  const finalFr = await buildFrenchLegalPage({ root: directory })
  assert.ok(!finalFr.includes(callout))
  assert.match(finalFr, /Version 1\.0 · En vigueur le 1 January 2027/)

  // One placeholder left anywhere brings the banner back.
  const trademarks = join(directory, "TRADEMARKS.md")
  await writeFile(
    trademarks,
    (await readFile(trademarks, "utf8")) + "\nContact [SUPPORT EMAIL].\n"
  )
  assert.ok((await buildLegalPage({ root: directory })).includes(callout))
})
