# Commerce: purchase → license key → delivery

The $19 desktop license is sold through Stripe Checkout and delivered by the
brochure Worker (`apps/brochure/worker`). No SDKs: the Worker calls Stripe and
Resend with `fetch`, signs keys with WebCrypto Ed25519, and stores licenses in
Cloudflare D1. The app verifies keys offline (`packages/whyfull/src/license.ts`);
nothing here is ever contacted by the app.

## Flow

```
Whyfull app ─► GET /buy/ ─► Stripe Checkout (hosted) ─► /thanks/?session_id=cs_…
                                   │                          │
                                   ▼                          ▼
                     POST /api/stripe/webhook        GET /api/license?session_id=
                     (verify signature, issue,       (confirm with Stripe, issue
                      email via Resend)               if needed, return key)
                                   └──────► D1 `licenses` ◄───┘
```

| Route                      | What it does                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /buy/`                | Creates a Checkout Session (one `STRIPE_PRICE_ID`, `customer_creation=always`, optional "Name on license" field, promotion codes, Stripe Tax if `STRIPE_AUTOMATIC_TAX=true`, `metadata.product=whyfull-desktop`) and 303-redirects. Without Stripe configured, or if Stripe errors, redirects to `/download/` (today's behavior). |
| `POST /api/stripe/webhook` | Verifies `Stripe-Signature` (HMAC-SHA256, 5-minute tolerance, any `v1` may match, 256 KiB body cap). Issues one license per paid session and emails it. Records full refunds. Other events: `200`.                                                                                                                                |
| `GET /api/license`         | Used by `/thanks/`. Returns the key for a paid session, issuing it now if the webhook hasn't arrived yet. `no-store`. Statuses: `ready`, `pending` (async payment), `open`, `refunded`, `invalid`.                                                                                                                                |
| `POST /api/recover`        | Takes an email; always answers `202 {"status":"sent"}` and emails all non-refunded keys for that address in the background. Rate limited.                                                                                                                                                                                         |
| `/thanks/`                 | Key, copy button, "Download license file" (.txt built in the browser), activation steps, installer links from `/api/downloads`.                                                                                                                                                                                                   |
| `/activate#key=…`          | Shows a key from the URL fragment (never sent to the server). This is the link in emails; the app's paste field also accepts the whole link.                                                                                                                                                                                      |
| `/recover/`                | Email form for `/api/recover`. Never shows keys.                                                                                                                                                                                                                                                                                  |

The former `CHECKOUT_URL` variable is gone: Stripe Checkout is the only
checkout. A third-party payment link could not issue keys through this flow.

### Licenses and idempotency

- Key format: `WHYFULL-<base64url(JSON)>.<base64url(Ed25519 signature)>`, the
  payload `{"v":1,"product":"whyfull-desktop","id":"WF-…","name"?,"issued":"YYYY-MM-DD"}`,
  identical to `scripts/license-issue.mjs`. License ids are `WF-` plus 12
  Crockford base32 characters.
- `licenses.stripe_session_id` is `UNIQUE`; issuing uses
  `INSERT … ON CONFLICT DO NOTHING` and then reads the stored row, so the
  webhook, Stripe retries and the thanks page always converge on one key.
- After signing, the Worker verifies the key against the public key the app
  ships with. A wrong `LICENSE_PRIVATE_KEY` (for example a test key in
  production) makes issuing fail with a 500 rather than sending keys the app
  would reject.
- Only the webhook sends the purchase email. If Resend fails, the webhook
  returns 500 and Stripe retries; the retry finds the license and only
  re-sends the email (`emailed_at` tracks it; Resend's `Idempotency-Key`
  `whyfull-license/<id>` prevents duplicates).
- Holder name: only the optional "Name on license" checkout field, never the
  cardholder name.

### Data stored (D1 `whyfull-licenses`)

`licenses`: id, email (lower-cased), name (optional), key, stripe_session_id,
stripe_customer_id, payment_intent, amount, currency, created_at, refunded_at,
emailed_at. `rate_limits`: SHA-256-hashed bucket names with a counter and
reset time; no raw IP addresses or emails.

### Rate limits

Fixed windows in D1: `/api/recover` allows 5 requests per IP and 3 per
email address per hour; `/api/license` allows 60 per IP per 10 minutes. Expired
counters are pruned after recovery requests. Rate-limited requests get `429`,
which says nothing about whether a license exists. For heavier abuse, add a
Cloudflare WAF rate-limiting rule on `/api/recover` in the dashboard.

### Security notes

- The thanks link (`session_id`) and activation link act as bearer tokens for
  the key, like the email itself. Key pages send `Referrer-Policy:
no-referrer` and `noindex`; key responses are `Cache-Control: no-store`.
- Logs contain only our own error messages and upstream status codes; never
  keys, emails, or request bodies.
- `/api/recover` rejects cross-origin `Origin` headers and bodies over 2 KiB.
- Pages load no inline scripts.

## Configuration

Non-secret vars live in `apps/brochure/wrangler.jsonc` under `vars`; secrets
are set with `wrangler secret put` (and `.dev.vars` locally, which git ignores).

| Name                    | Kind   | Purpose                                                                                       |
| ----------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | secret | `sk_live_…`/`sk_test_…`, or a restricted key with write access to Checkout Sessions.          |
| `STRIPE_WEBHOOK_SECRET` | secret | `whsec_…` of the webhook endpoint.                                                            |
| `STRIPE_PRICE_ID`       | var    | `price_…` of the one-time $19 Price. `/buy/` stays on the fallback until set.                 |
| `STRIPE_AUTOMATIC_TAX`  | var    | `"true"` enables Stripe Tax on Checkout (requires Stripe Tax set up). Default `"false"`.      |
| `LICENSE_PRIVATE_KEY`   | secret | Ed25519 private key, PKCS#8 PEM (literal `\n` escapes are accepted) or base64 DER.            |
| `RESEND_API_KEY`        | secret | Resend API key. Without it (or `EMAIL_FROM`) no email is sent and `/recover/` shows support.  |
| `EMAIL_FROM`            | var    | Sender on a Resend-verified domain, e.g. `Whyfull <licenses@whyfull.app>`.                    |
| `SUPPORT_EMAIL`         | var    | Reply-to for emails and the contact shown when email isn't configured.                        |
| `LICENSE_PUBLIC_KEY`    | var    | Tests and staging only: overrides the public key the app ships with. Never set in production. |

## Setup (owner)

Run these from `apps/brochure`.

1. **Stripe product.** Dashboard → Product catalog → Add product "Whyfull
   desktop license", one-time price $19.00 USD. Copy the `price_…` id into
   `STRIPE_PRICE_ID` in `wrangler.jsonc` `vars`. In Settings → Customer emails,
   turn on "Successful payments" so Stripe sends the receipt (our email says
   it comes separately). Optionally set the public business name, support
   email and the terms URL `https://whyfull.app/legal/` in Settings → Public
   details.
2. **Webhook.** Developers → Webhooks → Add endpoint
   `https://whyfull.app/api/stripe/webhook` with events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`
   and `charge.refunded`. Copy its signing secret.
3. **D1.**

   ```sh
   npx wrangler d1 create whyfull-licenses
   # Paste the printed database_id over the placeholder in wrangler.jsonc.
   npx wrangler d1 migrations apply whyfull-licenses --remote
   ```

   Until the placeholder id is replaced, `wrangler deploy` fails, so do this
   before the next deploy.

4. **Secrets.**

   ```sh
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   npx wrangler secret put RESEND_API_KEY
   # The license signing key: pipe the file so it never lands in shell history.
   npx wrangler secret put LICENSE_PRIVATE_KEY < ../../.signing/whyfull-license-private.pem
   ```

   The PEM can be piped as is. To store base64 DER instead:
   `openssl pkey -in ../../.signing/whyfull-license-private.pem -outform DER | base64 | npx wrangler secret put LICENSE_PRIVATE_KEY`.
   Anyone with this key can mint licenses; keep the original in a password
   manager.

5. **Email.** Create a Resend account, verify the `whyfull.app` sending domain
   (DNS records), create an API key with sending access, and set `EMAIL_FROM`
   and `SUPPORT_EMAIL` in `vars`.
6. Deploy: `pnpm --filter @whyfull/brochure deploy`.

## Test-mode dry run

Use Stripe test mode keys end to end, locally:

```sh
cd apps/brochure
npx wrangler d1 migrations apply whyfull-licenses --local
cat > .dev.vars <<'EOF'
STRIPE_SECRET_KEY=sk_test_…
STRIPE_PRICE_ID=price_…            # a test-mode price
STRIPE_WEBHOOK_SECRET=whsec_…      # printed by `stripe listen` below
LICENSE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"
EOF
pnpm preview                                   # wrangler dev on :3001
stripe listen --forward-to localhost:3001/api/stripe/webhook
```

Open <http://127.0.0.1:3001/buy/>, pay with card `4242 4242 4242 4242`, and
check that `/thanks/` shows a key that the desktop app accepts. Test
`4000 0000 0000 3220` (3-D Secure) and a 100% promotion code too. Refund the
payment in the dashboard (or `stripe refunds create --payment-intent pi_…`)
and confirm `refunded_at` is set:
`npx wrangler d1 execute whyfull-licenses --local --command "select id, refunded_at from licenses"`.

For a dry run that doesn't need the real signing key, generate a throwaway
pair, put its private key in `.dev.vars` and its public key in
`LICENSE_PUBLIC_KEY`; such keys only verify against that public key, not in the
released app. Automated tests (`pnpm --filter @whyfull/brochure test`) mock
Stripe, Resend and D1 and check that worker-issued keys pass the app's
`verifyLicenseKey`.

## Going live

1. Activate the Stripe account (business details, bank account).
2. Create the live product/price and live webhook endpoint (test and live
   objects are separate), then replace `STRIPE_PRICE_ID`,
   `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` with live values.
3. Make sure `LICENSE_PUBLIC_KEY` is not set in production.
4. Deploy, buy one license with a real card, activate it in the app, refund it.

## Refunds

Refunds are issued in the Stripe dashboard (30 days, no questions asked).
`charge.refunded` with a full refund sets `refunded_at`; partial refunds are
not recorded. The app is offline and keys cannot be revoked; a refunded key is
no longer offered by `/recover/` or `/api/license`, and that's all. This
matches the honor-system model.

## Decision for the owner: sales tax and VAT

Selling software to consumers worldwide makes the **seller** responsible for
VAT/GST in many countries (EU, UK, Australia, and others, often from the first
sale) and for US sales tax once state thresholds are crossed.

- **Stripe Tax** (`STRIPE_AUTOMATIC_TAX=true`): Stripe calculates and collects
  tax at checkout, but you remain the seller: you register in each
  jurisdiction where you have obligations and file returns (Stripe can file in
  some places for an added fee). Cheapest per sale; most admin.
- **Merchant of record** (Stripe Managed Payments, Paddle, Lemon Squeezy): the
  provider is the legal seller, handles registration, collection, filing and
  often chargebacks, for a higher fee (typically about 5% + fees). Paddle or
  Lemon Squeezy would need a different checkout and webhook integration; check
  whether Stripe Managed Payments is available for your account and works with
  Checkout Sessions as used here.

At $19 and low volume, a merchant of record is usually simpler for a solo
developer. Get advice for your jurisdiction before launch.

## Opening the app from activation links

The purchase email, the recovery email and the `/thanks/` and `/activate/`
pages offer an **Open in Whyfull** link,
`whyfull://activate?key=<encodeURIComponent(key)>`, above the web license page
and the copy button. The desktop app registers the `whyfull` scheme; opening the
link focuses the app and activates the key through the engine's local API, so
the buyer never copies anything. Copying the key (or pasting the whole
`https://whyfull.app/activate#key=…` link) into **Support Whyfull** remains the
fallback.

- The key is in the URL query here, unlike the web link's `#` fragment, but the
  link never goes to a server: the OS hands it straight to the app.
- Some webmail clients (notably Gmail on the web) strip or block non-`https`
  links, so the email keeps the web license page as the second option, and that
  page offers the same button.
- If Whyfull isn't installed, the browser does nothing or reports an unknown
  protocol; the page text points to copying the key instead.
- Platform details and testing are in
  [`apps/desktop/README.md`](../apps/desktop/README.md#license-and-trial).
