# Business model options

Decided 22 November 2026: free CLI, $19 desktop app, source-available code. Builds on
[comparable products](comparable-products.md). Competitor prices come from
public listings and have not been checked against their checkout pages.

## Where the market sits

| Product              | Model                                             | Price signal                                                            |
| -------------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| Mole (tw93)          | MIT CLI, very popular, separate paid Mac app      | Free; cleanup is a commodity for CLI users                              |
| Wombit               | Free analyzer, Pro unlock                         | $4.99 one-time, 3 Macs (third-party listing)                            |
| DaisyDisk            | Paid app, lifetime license                        | One-time (amount not confirmed)                                         |
| CleanMyMac           | Subscription or one-time purchase, also on Setapp | about $39.95/yr; one-time about $90–$190 depending on region            |
| Cap (other category) | AGPL source, paid license for the official build  | Shows that people pay for the signed build even when the source is open |

What this means for Whyfull:

- **Plain disk cleaning will not command a subscription.** Free OSS tools and
  $5 unlocks set the price anchor. CleanMyMac charges a subscription because of
  brand and broad scope, which Whyfull should not try to copy.
- **Whyfull's real advantages:** knowledge of developer and AI tools (models,
  Docker, Xcode, package stores, agent worktrees), explanations of what each
  removal costs, and output built for coding agents. Generic cleaners don't
  cover this well, and it's the part buyers would pay for.
- **The free path drives distribution.** `npx whyfull`, `--json`, the agent
  skill, and catalog pages are how people find the tool. Charging for any of
  them would cut off growth.

## Decision: free CLI, paid desktop app, teams later

### 1. Free forever: the CLI

CLI (npm, `npx`, standalone archives, and the CLI bundled in the app,
including `--ui`), opportunity report, JSON for agents, the skill, the target catalog, and
the read-only visual explorer. Publish the catalog as indexable pages (see the
first slice in [comparable products](comparable-products.md)) as the main
acquisition channel. Add GitHub Sponsors as a small extra.

### 2. Desktop app: $19 one-time, honor-system trial

**Decision:** the desktop app costs **$19 one-time**. It works fully during a
trial, then shows a friendly reminder, like WinRAR. `npx whyfull` and the CLI
never show the reminder.

Enforcement is honor-system: there's no private module and no DRM. Anyone
could reset the trial by deleting a local file or build the app without the
reminder. The reminder only needs to nudge people who already find the app
useful; the terms still require a license for continued desktop use, and the
missing lock is not permission.

The license is **$19 USD one-time, perpetual, per person**, on every computer
that person uses, with updates included and a 30-day no-questions refund.
Companies buy one license per person who uses the app; volume by contact. A
future major version may be a paid upgrade, announced in advance; existing
licenses keep working with the versions they cover.

#### Source available, not open source

Going forward the code is **source available, all rights reserved**. It stays
public so people can audit what a disk tool does on their machine, but the
source license grants no right to copy, modify, redistribute, or reuse the
code, the location catalog, or the docs. Use is governed by the EULA. This
replaces Apache-2.0 for everything after the relicensing commit; releases
published before it (npm `whyfull` 0.0.1–0.0.2, desktop 0.0.1, and the earlier
git history) remain under Apache-2.0 as published. The license never converts
to open source.

Why: Apache-2.0 let anyone ship the app, the catalog, or a rebranded copy
without the reminder, which removes the reason to pay. Source availability
keeps the trust benefit (anyone can read it) without that.

#### Reminder design

- **Trial:** 30 days on which the app was actually used (not calendar days).
  The first-use date is recorded in the normal `~/.config/whyfull/` folder,
  not hidden, so the app stays easy to trust.
- **Tie the reminder to value, not to time.** Show it after a completed scan:
  "Whyfull found 48 GB you could reclaim. If it helped, $19 supports it." It's
  a more convincing ask than "your trial expired".
- **Never block.** At most once per day, dismissible in one click, never during
  cleanup or a scan, never in CLI, JSON or agent output.
- **Licenses:** a signed key checked offline (for example Ed25519), with no
  phone-home and no account. "Already bought it" accepts a pasted key or the
  link from the purchase email.
- **Copy:** warm, not guilt-tripping. Tell people the CLI stays free forever.

#### What a license adds

The reminder is the main reason to pay, so perks only need to make buying feel
good, and make the app worth wanting. Avoid charging for safety or for anything
the CLI and agents share:

| Candidate                                     | Paid? | Why                                                                                                                 |
| --------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| Personalization (places, instructions, rules) | No    | The CLI and agents share `knowledge.json`, and keep rules protect data. Charging for it would hurt trust and agents |
| Cleanup, Trash, undo, safety explanations     | No    | Never charge for the safe path                                                                                      |
| **Watch mode / menu bar**                     | Yes   | Desktop only, delivers value every week: "Docker grew 40 GB", "3 worktrees idle for 30 days"                        |
| **History and trends**                        | Yes   | Answers "why is it full _again_": growth per tool over time. Fits the brand                                         |
| Supporter extras (app icons, themes, a badge) | Yes   | Cheap to build, nice to have when you've paid                                                                       |

Start with the reminder and history. Add watch mode next: it's the feature
most likely to make people want the app, because it brings them back without a
manual scan.

Copy says "source available", never "open source". The README, website,
and app say plainly: the CLI is free; the desktop app is free for 30 days,
then $19 once. A good line: "Whyfull's source is public so you can see exactly
what it does. You could build it without the reminder; if it saves you space,
$19 keeps it going."

### 3. Teams, once Pro has traction

Developer fleets have the same problem at scale, and companies pay per seat:

- Shared org catalog and policies (internal caches, "never remove X")
- MDM deployment, aggregate reports for dev machines and self-hosted CI runners
- Scheduled cleanup for build machines

About $4–6 per seat per month. Validate with 3–5 design partners before
building anything.

## What not to do

- No telemetry-based or data monetization. It contradicts "nothing leaves your
  computer", the core promise.
- No subscription for a consumer cleaner.
- Don't gate the agent JSON or skill.
- No ads or affiliate cleaner bundles.

## Next steps

1. Ship the catalog pages and the visible Suggestions flow first. They make
   the "found 48 GB" moment happen, and the reminder depends on it.
2. Add the trial counter, the value-based reminder, and offline license keys
   to the desktop app.
3. Checkout runs on Stripe Checkout through the whyfull.app Worker (`/buy/`,
   `/thanks/`, `/activate`, `/recover/`, `/legal/`). Measure conversion from
   checkout only, never from the app.
4. Build history and trends, then watch mode, as license extras.

## Sources

- [Wombit on BetterLaunch](https://www.betterlaunch.co/product/wombit)
- [CleanMyMac purchase options (MacPaw)](https://macpaw.com/support/cleanmymac/knowledgebase/purchase-options)
- [MacRumors: redesigned CleanMyMac pricing](https://www.macrumors.com/2024/10/16/macpaw-releases-redesigned-cleanmymac/)
- [DaisyDisk pricing](https://daisydiskapp.com/support/pricing)
- [Mole on GitHub](https://github.com/tw93/Mole)
- [How Cap makes money from open source](https://flaviocopes.com/cap-business-model/)
