# Whyfull End User License Agreement

Version 1.0 · Effective [EFFECTIVE DATE]

> **Draft: needs lawyer review before launch.** This agreement has not yet been
> reviewed by a lawyer. `[EFFECTIVE DATE]` stays empty on purpose until a
> lawyer approves it. Points to review:
>
> 1. **Merchant's address (Quebec).** The Consumer Protection Act requires a
>    merchant to disclose its address before a distance contract is made. Only
>    "Montreal, Quebec, Canada" is given; a mailing address may need adding to
>    Sections 1 and 21, unless Stripe's disclosures as merchant of record are
>    enough.
> 2. **Merchant of record.** Confirm the wording of Section 5 (Stripe as
>    reseller and merchant of record, Felix Menard as licensor) against
>    Stripe's Managed Payments terms, including the name of the Stripe entity
>    and who answers for refunds, the legal warranty and disputes.
> 3. **French version (Quebec).** Under the Charter of the French language, a
>    standard-form contract must be given to Quebec consumers in French first.
>    Confirm the language clause (Section 20) and the rule that the French
>    version prevails in Quebec, and check that the checkout, the website and
>    the desktop app show the French version first to Quebec customers.
> 4. **Quebec consumer law.** Check Sections 9 to 11 and 17 against the
>    Consumer Protection Act (legal warranty, exclusion of liability,
>    indemnities, unilateral changes) and the notice that precedes clauses that
>    do not apply in Quebec.
> 5. **Other countries.** Consumer rules in the EU, the UK and Australia (for
>    example the right of withdrawal for digital content and the liability
>    limits) cannot be waived by contract and may require changes to
>    Sections 5 and 9 to 11.

## Plain-English summary (not legally binding)

This summary helps you read the agreement. It is not part of it; if the two
differ, the numbered sections below apply.

- **The command line is free.** Use `whyfull` from npm, `npx whyfull`, the
  standalone CLI archives or the CLI bundled with the desktop app, for personal
  or commercial work, with no key.
- **The desktop app has a free 30-day evaluation.** Days are counted only when
  you open the app. After 30 days of use, keep using it by buying a license:
  **$19 USD, once**, for you, on all your computers, with updates.
- **Nothing gets locked.** The app keeps working after the trial and shows a
  reminder at most once a day. That's on purpose, but it isn't permission: the
  agreement still asks you to buy a license to keep using the app.
- **Stripe sells, we license.** Stripe handles checkout as the merchant of
  record: payment, sales tax, receipts and refunds. The license itself comes
  from us.
- **Refunds within 30 days**, no questions asked.
- **Whyfull sends nothing about you anywhere.** No telemetry, no license
  checks over the network.
- **You decide what to clean up.** Whyfull never deletes anything on its own.
  When you choose to move files to the Trash or run a tool's cleanup command,
  that's your action. Keep backups.
- **The software comes as is**, and our liability is limited to what you paid.

## 1. Who this agreement is between

This End User License Agreement (the "Agreement") is between you and Felix
Menard, an individual doing business in Montreal, Quebec, Canada ("we", "us",
"the Licensor"). "You" means the individual using Whyfull, or, if you accept
on behalf of a company or other organization, both you and that
organization. If you accept for an
organization, you confirm that you have authority to bind it.

By installing, copying, opening or otherwise using Whyfull, you agree to this
Agreement. If you do not agree, do not install or use Whyfull.

## 2. Definitions

- **"Whyfull"** or **"the Software"** means the Whyfull software in object
  code and source code form, including the CLI, the desktop app, the browser
  viewer, the location catalog, documentation, and any updates we provide,
  excluding Third-Party Components.
- **"CLI"** means Whyfull's command-line interface, however obtained: the npm
  package `whyfull` (including when run with `npx`), the standalone CLI
  archives, and the command-line tool bundled with the desktop app (the
  `whyfull --cli` command and the launcher the app installs). It includes the
  browser viewer started from the CLI (for example `whyfull --ui`).
- **"Desktop App"** means the Whyfull graphical application distributed as a
  desktop installer or bundle (for example a `.dmg`, `.exe`, `.AppImage` or
  `.deb`), other than its bundled CLI.
- **"Day of Use"** means a calendar day, in your computer's local time, on
  which the Desktop App is opened at least once.
- **"License Key"** means a key we issue to you after purchase that identifies
  your Desktop App license.
- **"Third-Party Components"** means software owned by others and included
  with Whyfull, such as the Node.js runtime and npm dependencies.

## 3. The CLI: free for personal and commercial use

Subject to this Agreement, we grant you a non-exclusive, non-transferable,
non-sublicensable, royalty-free, worldwide license to install and use the CLI,
on any number of computers you use or administer, for personal or commercial
purposes, including in scripts, continuous integration and with AI coding
agents. No License Key is needed for the CLI.

This license is to _use_ the CLI. It does not allow you to redistribute,
modify or reuse its code or catalog; those are governed by the Whyfull
Source-Available License (Section 6). You may, however, install the CLI from
the official npm package as a dependency of your own projects or
configurations, so that your users download it from npm themselves.

## 4. The Desktop App: evaluation, then a paid license

### 4.1 Evaluation

You may use the Desktop App free of charge for evaluation for 30 Days of Use
(the "Evaluation Period"). Days on which you do not open the Desktop App do
not count. The Evaluation Period applies once per person, not once per
computer or per reinstall.

### 4.2 License required after the Evaluation Period

After the Evaluation Period, you need a paid Desktop App license to continue
using the Desktop App. If you do not want to buy one, you must stop using the
Desktop App; you can keep using the CLI for free.

### 4.3 What a license includes

A Desktop App license, once paid for, is:

- **One-time:** a single payment of $19 USD (plus any applicable taxes), with
  no subscription.
- **Perpetual:** it does not expire, subject to Section 13 (Termination).
- **Per person:** it is for one named individual. That person may use the
  Desktop App on every computer they personally use, at work and at home.
  It may not be shared with, or used by, other people.
- **Updates included:** it covers updates to the Desktop App that we release
  for the major version you bought, and any later versions we choose to
  include.

We may in the future offer a new major version as a paid upgrade. If we do,
we will announce it in advance, and your existing license will keep working
with every version it already covers. We are not obliged to release updates
or new versions.

Prices may change for future purchases. A price change never affects a
license you have already bought.

### 4.4 Companies and teams

An organization needs one license for each person who uses the Desktop App.
A license bought by an organization may be assigned to one person at a time
and reassigned when that person no longer uses the Desktop App (for example
when they leave the team), but not used to cover people on a rotating or
shared basis. For volume purchases or other terms, contact
support@whyfull.app.

### 4.5 Honor system and reminders

The Desktop App does not lock features, does not stop working and does not
check your license over the network. After the Evaluation Period it shows a
reminder, at most once a day after a scan, until a License Key is entered.

**The absence of technical enforcement is not permission.** Continued use of
the Desktop App after the Evaluation Period without a license is a breach of
this Agreement, whether or not the Software detects it or shows a reminder,
and whether you use an official build or one you built from source.

### 4.6 License Keys

License Keys are personal and confidential to the licensed person. Do not
publish, share, sell or transfer them, and do not create, alter or forge
License Keys. We may revoke a License Key that was generated or obtained
fraudulently, refunded or charged back, or shared in breach of this
Agreement. If you lose your key, you can recover it at
https://whyfull.app/recover/.

### 4.7 No audits

We will not audit your computers or ask you to report usage. We rely on you
to buy the licenses you need. This does not limit our remedies if we learn
of a breach.

## 5. Purchase, price, taxes and refunds

### 5.1 Who sells and who licenses

Desktop App licenses are sold through Stripe Managed Payments. For the
purchase transaction, Stripe (the Stripe company named at checkout and on
your receipt) acts as reseller and merchant of record: it sells you the
license, collects your payment, calculates, collects and remits any sales
tax, VAT or GST, issues your receipt or invoice, and processes refunds,
chargebacks and payment disputes, under its own terms presented at checkout.

We are the licensor. The right to use the Desktop App is granted by us under
this Agreement, and we remain responsible for the Software, License Keys and
support. Stripe's terms govern the purchase transaction; this Agreement
governs your use of Whyfull.

### 5.2 Price and taxes

A Desktop App license costs $19 USD. Stripe shows the applicable taxes for
your location, and the total you will pay, at checkout before you confirm
the purchase. You authorize the total shown at checkout. Your bank or card
issuer may charge its own currency-conversion fees.

### 5.3 Refunds

If Whyfull isn't right for you, you may ask for a full refund within 30 days
of purchase, for any reason, by writing to support@whyfull.app or by using
the contact details in your receipt. Refunds are processed through Stripe to
your original payment method. When a purchase is refunded, its license and
License Key end, and you must stop using the Desktop App beyond the
Evaluation Period. This does not limit any statutory rights you have to a
refund, cancellation or withdrawal.

## 6. Source code and the source-available license

Whyfull's source code is publicly visible so you can see exactly what it
does. Access to the source is governed by the Whyfull Source-Available
License (the `LICENSE` file), which allows you to read, audit and contribute,
but does not allow copying, modification, redistribution or reuse. Seeing or
building the source does not give you any additional right to use the
Desktop App: a build you make yourself is covered by the same evaluation and
license terms as an official build.

## 7. Restrictions

Except as this Agreement or the Source-Available License expressly allows,
you may not:

1. copy, modify, adapt, translate or create derivative works of Whyfull;
2. distribute, sell, rent, lease, lend, sublicense, host or otherwise make
   Whyfull available to others, including as part of another product or
   service, or as a hosted or managed service;
3. distribute a build of the Desktop App with its evaluation or license
   reminders removed or disabled, or distribute License Keys or tools that
   generate them;
4. reuse the location catalog or documentation in another product;
5. remove or alter any copyright, trademark or license notice; or
6. use Whyfull in breach of any applicable law.

Nothing in this section prevents you from doing something that applicable
law expressly allows despite a contractual restriction (for example limited
reverse engineering for interoperability where the law permits it).

## 8. How Whyfull works with your files

You should understand these facts before using Whyfull:

1. **Whyfull reads your disk.** It scans folders you choose, or default
   locations, and reports sizes, file paths and cleanup suggestions. Reports
   and caches are stored on your computer.
2. **Whyfull never deletes anything automatically.** Scanning and reporting
   do not change your files. Cleanup happens only when you explicitly ask
   for it.
3. **Cleanup is your action.** When you choose to move items to the Trash,
   run a cleanup command recommended for the tool that owns the data (for
   example a package manager, container tool or model runner), or follow
   any other suggestion, you are the one initiating that action. Labels such
   as "safe", "rebuildable" or "cache" are best-effort guidance based on
   general knowledge of how other software behaves; they may be wrong for
   your setup, and other software can change without notice.
4. **Trash is not a backup.** Items moved to the Trash may be removed
   permanently by your operating system, by you, or by other software, and
   owning-tool cleanup commands may delete data permanently. Some deleted
   data (for example downloaded AI models or caches) may be large or slow to
   restore, and some (for example uncommitted work in a git worktree) may not
   be restorable at all.
5. **You are responsible for your data.** You are responsible for reviewing
   what you clean up, for keeping current backups of anything you care
   about, and for any loss of data, time, work or configuration that results
   from cleanup you initiate.
6. **Reports may contain private information.** File paths and project names
   can be sensitive. You decide whether to share a report, for example with
   an AI agent or another person.

## 9. No warranty

_Consumers in Quebec: this section does not apply to you to the extent that
the Consumer Protection Act or the Civil Code of Québec prohibits it,
including the legal warranties of quality and of conformity, which this
Agreement does not exclude._

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, WHYFULL IS PROVIDED "AS IS"
AND "AS AVAILABLE", WITH ALL FAULTS AND WITHOUT WARRANTY OF ANY KIND. WE
DISCLAIM ALL WARRANTIES, EXPRESS, IMPLIED OR STATUTORY, INCLUDING ANY
WARRANTY OF MERCHANTABILITY, SATISFACTORY QUALITY, FITNESS FOR A PARTICULAR
PURPOSE, ACCURACY, QUIET ENJOYMENT, TITLE AND NON-INFRINGEMENT, AND ANY
WARRANTY THAT WHYFULL WILL BE ERROR-FREE, UNINTERRUPTED, SECURE, COMPATIBLE
WITH YOUR SYSTEM, OR THAT ITS SIZES, CLASSIFICATIONS OR CLEANUP SUGGESTIONS
WILL BE CORRECT OR COMPLETE. YOU USE WHYFULL AT YOUR OWN RISK.

## 10. Limitation of liability

_Consumers in Quebec: this section does not apply to you to the extent that
the Consumer Protection Act or the Civil Code of Québec prohibits it,
including where it would exclude or limit our liability for our own acts or
those of our representatives._

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:

1. WE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
   CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF DATA,
   FILES, MODELS, CACHES, WORK, PROFITS, REVENUE, BUSINESS, GOODWILL OR
   USE, OR COST OF RECOVERY, RE-DOWNLOAD OR REPLACEMENT, HOWEVER CAUSED AND
   UNDER ANY THEORY OF LIABILITY, EVEN IF WE WERE ADVISED OF THE
   POSSIBILITY OF SUCH DAMAGES.
2. WITHOUT LIMITING THE ABOVE, WE ARE NOT LIABLE FOR THE CONSEQUENCES OF
   ANY CLEANUP YOU INITIATE, INCLUDING MOVING ITEMS TO THE TRASH, EMPTYING
   THE TRASH, OR RUNNING ANY OWNING TOOL'S CLEANUP COMMAND, WHETHER OR NOT
   WHYFULL SUGGESTED IT OR LABELLED THE ITEM AS SAFE.
3. OUR TOTAL LIABILITY FOR ALL CLAIMS RELATING TO WHYFULL OR THIS
   AGREEMENT IS LIMITED TO THE GREATER OF (A) THE AMOUNT YOU PAID US FOR
   WHYFULL IN THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM AND
   (B) USD 20.

These limits apply even if a remedy fails of its essential purpose. Some
jurisdictions do not allow certain exclusions or limits; in that case they
apply only to the extent allowed, and nothing in this Agreement limits
liability that cannot be limited by law (for example for death or personal
injury caused by negligence, or for fraud).

## 11. Your responsibility to us

To the extent permitted by law, you will indemnify us against third-party
claims arising from your breach of this Agreement or your use of Whyfull in
breach of law. This section does not apply to consumers where the law does
not allow it, including consumers in Quebec.

## 12. Privacy

Whyfull's CLI and Desktop App do not send telemetry, analytics, crash
reports, scan results or file paths to us or anyone else, and License Keys
are verified offline on your computer. The Desktop App may check for and
download updates from GitHub, which works like downloading any file from
the internet. Our handling of purchase data is described in the Privacy
Notice (`PRIVACY.md`, also at https://whyfull.app/legal/#privacy; in French,
`PRIVACY.fr.md` and https://whyfull.app/legal/fr/#confidentialite).

## 13. Termination

This Agreement continues until terminated. You may terminate it at any time
by uninstalling Whyfull and deleting your copies. Your rights under this
Agreement end automatically, without notice, if you materially breach it
(including by using the Desktop App beyond the Evaluation Period without a
license and not purchasing one within a reasonable time after we notify you).
On termination you must stop using Whyfull and delete it. Termination does
not entitle you to a refund except as stated in Section 5.3 or required by
law. Sections 6 to 11 and 13 to 20 survive termination.

## 14. Export and sanctions

You will comply with all export control and sanctions laws that apply to
your use of Whyfull. You confirm that you are not located in, or a resident
of, a country or region subject to comprehensive sanctions, and that you are
not on any government list of prohibited or restricted parties. You will not
use or export Whyfull in breach of those laws.

## 15. Third-Party Components

Whyfull includes Third-Party Components that are licensed under their own
terms, listed in `NOTICE` and in the third-party notice files shipped with
each build. Those terms govern the Third-Party Components, and nothing in this
Agreement limits rights they grant you.

## 16. Trademarks

"Whyfull", its logo and icon are trademarks of Felix Menard. This Agreement
grants no rights in them. See `TRADEMARKS.md`.

## 17. Changes to this Agreement

We may update this Agreement from time to time and will publish the new
version at https://whyfull.app/legal/ with a new effective date. Changes
apply to versions of Whyfull released after the change. The version of this
Agreement shipped with, or in effect when you obtained, a given version of
Whyfull continues to govern that version, and a change never removes a
perpetual license you have already bought or reduces the versions it
covers.

## 18. Assignment

You may not assign or transfer this Agreement or a license, except that an
organization may reassign a license between its people as described in
Section 4.4. We may assign this Agreement, for example in connection with a
merger, acquisition or sale of the Whyfull business, provided the assignee
honors existing licenses.

## 19. Governing law and disputes

This Agreement is governed by the laws of the Province of Quebec and the
federal laws of Canada applicable there, without regard to conflict-of-laws
rules. The United Nations Convention on Contracts for the International Sale
of Goods does not apply. The courts of the judicial district of Montreal,
Quebec, have exclusive jurisdiction, except that either party may seek
injunctive relief in any competent court.

If you are a consumer, nothing in this section deprives you of the
protection of the mandatory rules of the law of the place where you live, or
of any right that law gives you to bring proceedings in the courts of your
place of residence. For example, consumers in Quebec keep the rights given
by section 22.1 of the Consumer Protection Act, and consumers in the European
Union and the United Kingdom keep the protections of their consumer law.

## 20. General

- **Entire agreement.** This Agreement, together with the Source-Available
  License and the Privacy Notice, is the entire agreement between you and us
  about Whyfull and replaces any earlier understanding about it. Terms in a
  purchase order or other document you send do not apply.
- **Severability.** If any provision is held invalid or unenforceable, it
  will be enforced to the maximum extent permitted, and the remaining
  provisions stay in effect.
- **No waiver.** Our failure or delay in enforcing a provision is not a
  waiver of it.
- **Earlier versions.** Versions of Whyfull published under the Apache
  License 2.0 before these terms took effect (npm `whyfull` 0.0.1 and 0.0.2
  and Desktop App 0.0.1) remain available under that license as they were
  published. This Agreement applies to later versions.
- **Language.** This Agreement is available in French (`EULA.fr.md`, also at
  https://whyfull.app/legal/fr/) and in English. The French version is made
  available to consumers in Quebec first, before the English version, and
  you may choose to be bound by the English version only after the French
  version has been made available to you. Both versions have the same legal effect. If they
  differ, the French version prevails for consumers in Quebec, and the
  English version prevails for everyone else.
- **Notices.** We may send notices to the email address associated with your
  purchase. You may send notices to support@whyfull.app.

## 21. Contact

Felix Menard, Montreal, Quebec, Canada
Email: support@whyfull.app (legal questions, privacy, support, security and
volume purchases)
Web: https://whyfull.app/legal/ (in French: https://whyfull.app/legal/fr/)
