# Whyfull Privacy Notice

Version 1.0 · Effective [EFFECTIVE DATE]

> **Draft: needs lawyer review before launch.** Placeholders to fill in:
> `[LEGAL ENTITY / ADDRESS]`, `[CONTACT EMAIL]`, `[EFFECTIVE DATE]`,
> `[EMAIL PROVIDER]`, `[RETENTION PERIOD]`. Depending on where you sell, a
> lawyer may also need to add jurisdiction-specific sections (for example
> GDPR legal bases and an EU/UK representative, or California notices).

## Short version

- **The Whyfull CLI and desktop app collect nothing.** No telemetry, no
  analytics, no crash reports, no scan results, no license phone-home.
- **Buying a license** stores only what we need to issue and recover it:
  your email, optionally your name, the license id, payment provider ids and
  the issue date.
- **We never sell your data** and never use it for advertising.

## 1. Who is responsible

Felix Menard, [LEGAL ENTITY / ADDRESS] ("we", "us"), is responsible for the
personal data described here. Contact: [CONTACT EMAIL].

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

### What we collect

When you buy a license, we collect and store:

- your **email address** (to send and recover your license key);
- your **name**, if you provide it (it can be included in the license key);
- the **license id** and **issue date**;
- **payment provider ids** (for example Stripe customer, checkout session
  and payment ids), so we can handle refunds and support.

Card numbers and other payment details are entered directly with Stripe and
are never received or stored by us.

When you use the license recovery page, we use the email you enter to look
up licenses and send a recovery email to that address.

When you visit whyfull.app, our hosting provider processes standard
technical data (such as IP address, user agent and requested URL) to deliver
and protect the site. We do not use advertising or cross-site tracking
cookies on whyfull.app.

The `/activate` page reads the license key from the part of the link after
`#`, which browsers do not send to the server, so the key is not logged by
the website.

### Why we use it

To deliver what you bought (issuing, sending and recovering license keys),
to process payments and refunds, to prevent fraud and abuse, to answer
support requests, and to meet legal, tax and accounting obligations.

## 4. Service providers (processors)

We share data only with providers that process it on our behalf:

| Provider                           | What it does                                           |
| ---------------------------------- | ------------------------------------------------------ |
| **Stripe**                         | Checkout, payments, receipts, refunds and tax handling |
| **Cloudflare**                     | Hosting of whyfull.app and storage of license records  |
| **[EMAIL PROVIDER]** (if used)     | Sending license and recovery emails                    |
| **GitHub** (independent, not ours) | Hosting downloads, releases and update manifests       |

Some providers may process data outside your country, including in the
United States, under the safeguards they offer (for example standard
contractual clauses). We may also disclose data if required by law.

## 5. How long we keep it

We keep license records for as long as your license exists, so you can
recover your key, and as long as needed for tax and accounting obligations
([RETENTION PERIOD]). Payment records are kept by Stripe under its own
retention rules. Server logs at our hosting provider are kept only briefly.

## 6. Your rights

Depending on where you live, you may have the right to access, correct,
delete or export your personal data, to object to or restrict its
processing, and to complain to a data protection authority. To use these
rights, write to [CONTACT EMAIL]. If you ask us to delete your purchase
record, we will no longer be able to recover your license key for you; we
may need to keep some data for legal obligations.

## 7. Children

Whyfull is not directed to children, and we do not knowingly collect data
from children.

## 8. Changes

We will publish changes to this notice at https://whyfull.app/legal/#privacy
with a new effective date.

## 9. Contact

Felix Menard, [LEGAL ENTITY / ADDRESS] · [CONTACT EMAIL]
