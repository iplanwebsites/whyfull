# Whyfull Privacy Notice

Version 1.0 · Effective [EFFECTIVE DATE]

> **Draft: needs lawyer review before launch.** `[EFFECTIVE DATE]` stays
> empty on purpose until a lawyer approves this notice. Points to review:
> Stripe's role as an independent controller under Managed Payments, the
> Quebec rules on communicating personal information outside Quebec (an
> assessment may be required for Cloudflare, Resend and Stripe), the legal
> bases for the EU and the UK and whether an EU/UK representative is needed,
> and any California or other U.S. state notices.

## Short version

- **The Whyfull CLI and desktop app collect nothing.** No telemetry, no
  analytics, no crash reports, no scan results, no license phone-home.
- **Buying a license** stores only what we need to issue and recover it:
  your email, optionally your name, the license id and key, Stripe order ids
  and the issue date.
- **Stripe handles your payment** as merchant of record, under its own
  privacy policy. We never see your card details.
- **We never sell your data** and never use it for advertising.

## 1. Who is responsible

Felix Menard, an individual doing business in Montreal, Quebec, Canada
("we", "us"), is responsible for the personal information described here.

Felix Menard is also the person in charge of the protection of personal
information under Quebec's Act respecting the protection of personal
information in the private sector. Contact: support@whyfull.app.

## 2. The software: CLI and desktop app

Whyfull runs on your computer. Scans, reports, settings, Keep/Exclude rules
and caches are stored locally (for example in `~/.config/whyfull`) and are
never sent to us.

- **No telemetry or analytics.** The software does not report usage, errors,
  file paths or anything about your disk.
- **Offline license checks.** License keys are verified on your computer with
  a public key built into the app. Entering a key sends nothing.
- **Update checks.** The desktop app checks for updates by downloading a
  release manifest from GitHub, and downloads updates from GitHub when you
  choose to install them. Like any download, GitHub receives your IP address
  and standard request information under its own privacy policy. These
  requests contain no identifier from Whyfull.
- **Links you open.** If you open a link from the app (for example to buy a
  license), your browser visits that page and the website section below
  applies.
- **Reports you share.** If you give a report to an AI agent or another
  person, what happens to it is governed by your choice and their terms, not
  ours.

## 3. The website and purchases

### Payments: Stripe as merchant of record

Licenses are sold through Stripe Managed Payments. Stripe is the merchant of
record for your purchase: it collects your payment, calculates and remits
sales tax or VAT, issues receipts and invoices, and handles refunds and
disputes. For that, Stripe collects and uses your payment details, billing
address, tax location and related information as an independent controller,
under its own privacy policy (https://stripe.com/privacy). Card numbers and
other payment details are entered directly with Stripe and are never
received or stored by us.

### What we receive and store

After a purchase, Stripe sends us, and we store:

- your **email address** (to send and recover your license key);
- your **name**, if you provide it (it can be included in the license key);
- the **license id**, the **license key** and the **issue date**;
- **Stripe order ids** (the checkout session, customer and payment ids), and
  the amount and currency paid, so we can match refunds and answer support
  requests;
- whether and when the license email was sent, and whether and when the
  purchase was refunded.

When you use the license recovery page, we use the email you enter to look
up licenses and send a recovery email to that address.

To limit abuse of the license and recovery pages, we keep short-lived
counters keyed by a one-way hash (SHA-256) of your IP address and, for the
recovery page, of the email you enter. The raw IP address and email are not
stored in these counters.

When you visit whyfull.app, our hosting provider processes standard
technical data (such as IP address, user agent and requested URL) to deliver
and protect the site. We do not use advertising or cross-site tracking
cookies on whyfull.app.

The `/activate` page reads the license key from the part of the link after
`#`, which browsers do not send to the server, so the key is not logged by
the website.

### Why we use it

To deliver what you bought (issuing, sending and recovering license keys),
to match refunds, to prevent fraud and abuse, and to answer support
requests. In the European Union and the United Kingdom, the legal bases are
the performance of our contract with you (issuing and recovering licenses),
our legitimate interests (preventing abuse, answering support) and
compliance with legal obligations.

## 4. Service providers

| Provider                           | What it does                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| **Stripe** (independent)           | Merchant of record: checkout, payments, taxes, receipts, refunds and disputes      |
| **Cloudflare** (processor)         | Hosting of whyfull.app and storage of license records                              |
| **Resend** (processor)             | Sending license and recovery emails (it receives your email, name and license key) |
| **GitHub** (independent, not ours) | Hosting downloads, releases and update manifests                                   |

Processors handle data only on our behalf and under our instructions. These
providers may store or process data outside Quebec and Canada, including in
the United States, under the safeguards they offer (for example standard
contractual clauses). We may also disclose data if required by law.

## 5. How long we keep it

- **License records** (Section 3) are kept so you can recover your key at
  any time, until you ask us to delete them. Refunded purchases stay in the
  records, marked as refunded.
- **Abuse-prevention counters** expire after 10 minutes (license page) or
  one hour (recovery page), and expired counters are deleted automatically.
- **Payment, tax and invoice records** are kept by Stripe under its own
  retention policies.
- **Emails** sent through Resend, and server logs at our hosting provider,
  are kept under those providers' own short retention rules.

## 6. Your rights

Depending on where you live, you may have the right to access, correct,
delete or export your personal information, to withdraw your consent, to
object to or restrict its processing, and to complain to a data protection
authority. In Quebec, that is the Commission d'accès à l'information; in
Canada, the Office of the Privacy Commissioner of Canada. To use these
rights, write to support@whyfull.app. We answer within 30 days. If you ask
us to delete your purchase record, we will no longer be able to recover your
license key for you. Records held by Stripe as merchant of record are
governed by Stripe's privacy policy; we can help you contact Stripe.

## 7. Children

Whyfull is not directed to children, and we do not knowingly collect data
from children.

## 8. Changes

We will publish changes to this notice at https://whyfull.app/legal/#privacy
with a new effective date.

## 9. Language

This notice is available in French (`PRIVACY.fr.md`, also at
https://whyfull.app/legal/fr/#confidentialite) and in English. If the two
differ, the French version prevails for people in Quebec, and the English
version prevails for everyone else.

## 10. Contact

Felix Menard, Montreal, Quebec, Canada · support@whyfull.app
