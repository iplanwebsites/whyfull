# Commercial launch checklist

The first source-available release: a free CLI, and a desktop app that costs
$19 after a 30-day trial. Run these steps in order. Details live in
[commerce.md](commerce.md) (checkout and keys),
[desktop-builds.md](desktop-builds.md) (CI and signing) and
[business-model.md](business-model.md) (why).

## 1. Legal (blocking)

- [ ] Fill in the placeholders in `EULA.md`, `PRIVACY.md`, `TRADEMARKS.md`,
      `CONTRIBUTING.md`, `LICENSE` and `apps/brochure/legal/index.html`:
      `[LEGAL ENTITY / ADDRESS]`, `[GOVERNING LAW]`, `[VENUE]`,
      `[CONTACT EMAIL]`, `[EFFECTIVE DATE]`, `[EMAIL PROVIDER]`,
      `[RETENTION PERIOD]`.
- [ ] Have a lawyer review it. Open points:
  - **Refund and liability wording in other countries.** "No questions asked"
    refunds and the liability limits may clash with EU, UK and Australian
    consumer law.
  - **The contributor agreement.** It assigns copyright, and some countries
    don't allow assignment or waiving moral rights. Agreeing by a statement in
    a pull request may also be weak evidence.
  - **The honor system as a contract.** Using the app past the trial without
    paying is treated as a breach, with no technical enforcement.
  - **Source-license limits.** Whether "review only" use of the source and the
    ban on AI training can be enforced.
- [ ] The legal page (`apps/brochure/legal/index.html`) is now generated
      from the Markdown files by `apps/brochure/scripts/build-legal.mjs` on
      every brochure build. After changing the Markdown, run
      `pnpm --filter @whyfull/brochure legal` and commit the page; the
      brochure typecheck fails while it is stale. The "Draft" banner disappears
      once no `[PLACEHOLDER]` is left.
- [ ] Confirm that whyfull.app has Cloudflare Web Analytics switched off, or
      update `PRIVACY.md` to say it's on.

## 2. Keys and secrets

- [ ] Back up `.signing/whyfull-license-private.pem` to a password manager.
      Losing it means existing apps reject every new key, and leaking it lets
      anyone issue keys.
- [ ] Stripe: create the product and the $19 USD price, a webhook endpoint
      for `checkout.session.completed`,
      `checkout.session.async_payment_succeeded` and `charge.refunded`, and
      turn on receipt emails for successful payments.
- [ ] Decide how to handle sales tax: Stripe Tax (you register and file
      yourself) or a merchant of record that handles it for you (see
      commerce.md).
- [ ] Database: run `wrangler d1 create whyfull-licenses`, paste the real
      `database_id` into `apps/brochure/wrangler.jsonc` (deploys fail until
      you do), then apply the migrations.
- [ ] Email: verify the sending domain with Resend and set `EMAIL_FROM` and
      `SUPPORT_EMAIL`.
- [ ] Set the secrets with `wrangler secret put`: `STRIPE_SECRET_KEY`,
      `STRIPE_WEBHOOK_SECRET`, `LICENSE_PRIVATE_KEY` and `RESEND_API_KEY`.
      Set the variable `STRIPE_PRICE_ID`. Never set `LICENSE_PUBLIC_KEY` in
      production.

## 3. Test in Stripe test mode

- [ ] Deploy the site with test-mode keys.
- [ ] Buy with a test card. Check that the thank-you page shows the key, the
      email arrives with the activation link, and recovering the license by
      email works.
- [ ] Paste the activation link into a local desktop build. It should say
      "Licensed to …" and the reminder should stop.
- [ ] Refund the test purchase and check that the database records it.

## 4. Release order

1. Commit the relicensing as one commit. Everything up to it stays
   Apache-2.0, and everything after it follows the new terms.
2. Switch the site to live Stripe keys and deploy it **before** the app
   release, because the app's Buy button opens whyfull.app/buy/.
3. Publish npm `whyfull` 0.1.0 (already set in package.json). Never publish
   `0.0.3`: the docs name 0.0.1 and 0.0.2 as the last Apache releases.
   Afterwards, check that the npm page shows the new license and includes
   `EULA.md`.
4. Desktop (already at 0.1.0): build a test version with
   the "build-only" release mode on GitHub CI, check the trial and reminder
   on both Macs, then tag the release.
5. Update the GitHub repository's description and topics. GitHub will show
   the license as "Other", which is expected.

## 5. Windows

Windows ships after the entry criteria in desktop-builds.md are met. For a
paid app, signing the Windows installer comes first; the steps are under
"Revisit before Windows joins stable" in that file.

## 6. After launch

- [ ] Track conversion only through Stripe. The app sends no data anywhere.
- [ ] Every few weeks, read refund reasons and support emails.
- [ ] Next features worth paying for: scan history and trends, then a watch
      mode (business-model.md).
