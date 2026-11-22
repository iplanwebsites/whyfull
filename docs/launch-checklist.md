# Commercial launch checklist

The first source-available release: a free CLI, and a desktop app that costs
$19 after a 30-day trial. Run these steps in order. Details live in
[commerce.md](commerce.md) (checkout and keys),
[desktop-builds.md](desktop-builds.md) (CI and signing) and
[business-model.md](business-model.md) (why).

## 1. Legal (blocking)

- [x] Fill in the placeholders in `EULA.md`, `PRIVACY.md`, `TRADEMARKS.md`,
      `CONTRIBUTING.md` and `LICENSE`: Felix Menard, Montreal, Quebec,
      Canada; Quebec law and the courts of Montreal (consumers keep their own
      law and courts); support@whyfull.app; Resend; retention taken from the
      code. Only `[EFFECTIVE DATE]` is left, on purpose: set it once the
      lawyer approves, and the "Draft" banner goes away.
- [x] French versions for Quebec: `EULA.fr.md` and `PRIVACY.fr.md`, published
      at whyfull.app/legal/fr/.
- [ ] Have a lawyer review it. The full list is at the top of `EULA.md`.
      Open points:
  - **Merchant's address.** Quebec's Consumer Protection Act requires the
    merchant's address in a distance contract. Only "Montreal, Quebec,
    Canada" is given; add a mailing address if the lawyer says Stripe's
    disclosures as merchant of record are not enough.
  - **Merchant of record.** Confirm the EULA (Section 5) and privacy wording
    against Stripe's Managed Payments terms: Stripe as reseller and merchant
    of record, Felix Menard as licensor, Stripe as an independent controller
    for payment data, and who answers for refunds and the legal warranty.
  - **French first (Quebec).** The Charter of the French language requires
    standard-form consumer contracts in French, given before any English
    version. Confirm the language clauses (the French version prevails in
    Quebec), and make the checkout, the website and the desktop app show the
    French version first to Quebec customers. Today the npm package and the
    desktop app bundle only the English `EULA.md` and `PRIVACY.md`, and
    `LICENSE`, `TRADEMARKS.md` and `CONTRIBUTING.md` exist in English only.
  - **Quebec consumer and privacy law.** The notices before Sections 9 and 10
    of the EULA, the legal warranty, the indemnity and changes to the terms;
    for Law 25, whether communicating data outside Quebec (Cloudflare,
    Resend, Stripe) needs a written assessment.
  - **Refund and liability wording in other countries.** "No questions asked"
    refunds, the EU/UK withdrawal right for digital content and the liability
    limits may clash with EU, UK and Australian consumer law.
  - **The contributor agreement.** It assigns copyright, and some countries
    don't allow assignment or waiving moral rights. Agreeing by a statement in
    a pull request may also be weak evidence.
  - **The honor system as a contract.** Using the app past the trial without
    paying is treated as a breach, with no technical enforcement.
  - **Source-license limits.** Whether "review only" use of the source and the
    ban on AI training can be enforced.
- [ ] The legal pages (`apps/brochure/legal/index.html` and, in French,
      `apps/brochure/legal/fr/index.html`) are generated from the Markdown
      files by `apps/brochure/scripts/build-legal.mjs` on every brochure
      build. Add `legal/fr/index.html` to the Vite inputs in
      `apps/brochure/vite.config.ts`. After changing the Markdown, run
      `pnpm --filter @whyfull/brochure legal` and commit the page; the
      brochure typecheck fails while either page is stale. The "Draft"
      banner disappears once no `[PLACEHOLDER]` is left.
- [ ] Confirm that whyfull.app has Cloudflare Web Analytics switched off, or
      update `PRIVACY.md` and `PRIVACY.fr.md` to say it's on.

## 2. Keys and secrets

- [ ] Back up `.signing/whyfull-license-private.pem` to a password manager.
      Losing it means existing apps reject every new key, and leaking it lets
      anyone issue keys.
- [ ] Stripe: create the product and the $19 USD price, a webhook endpoint
      for `checkout.session.completed`,
      `checkout.session.async_payment_succeeded` and `charge.refunded`, and
      turn on receipt emails for successful payments.
- [ ] Sales tax: decided, Stripe Managed Payments as merchant of record.
      Activate Managed Payments in the Stripe dashboard (eligibility review),
      then set `STRIPE_MANAGED_PAYMENTS` to `"true"` in `wrangler.jsonc`.
- [ ] Database: run `wrangler d1 create whyfull-licenses`, paste the real
      `database_id` into `apps/brochure/wrangler.jsonc` (deploys fail until
      you do), then apply the migrations.
- [ ] Email (Mailjet, reusing the Kicking Lotus account): the
      `*@whyfull.app` sender exists and `MAILJET_API_KEY`/`MAILJET_SECRET_KEY`
      are uploaded to both sites. Add these TXT records to the whyfull.app
      zone in Cloudflare DNS (DNS only), then ask Mailjet to check the domain:
  - `mailjet._2cd0b883.whyfull.app` → `2cd0b8835245ad8701fca8d0e3cea027`
  - `mailjet._domainkey.whyfull.app` → the DKIM key shown in Mailjet
    (Account → Domains → whyfull.app), starting `k=rsa; p=MIIBIjAN…`
  - `whyfull.app` → `v=spf1 include:spf.mailjet.com ?all` (merge with Cloudflare
    Email Routing's `include:_spf.mx.cloudflare.net` if you add routing)

  Once verified, set `EMAIL_FROM` to `Whyfull <licenses@whyfull.app>` and
  `SUPPORT_EMAIL` to `support@whyfull.app` in `wrangler.jsonc` (both
  environments) and redeploy. Until then the site sends no email.

- [ ] Support inbox: support@whyfull.app is already published in the terms.
      Turn on Cloudflare Email Routing for whyfull.app and forward
      `support@` to your inbox.
- [ ] Set the secrets with `wrangler secret put`: `STRIPE_SECRET_KEY`,
      `STRIPE_WEBHOOK_SECRET` and `RESEND_API_KEY`. `LICENSE_PRIVATE_KEY` is uploaded
      (re-run `pnpm --filter @whyfull/brochure secret:license` if the key changes).
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
