# Business model options

Working recommendation, 22 November 2026. Builds on
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

## Recommendation: open core, paid desktop Pro, teams later

### 1. Free forever (Apache 2.0)

CLI, opportunity report, JSON for agents, the skill, the target catalog, and
the read-only visual explorer. Publish the catalog as indexable pages (see the
first slice in [comparable products](comparable-products.md)) as the main
acquisition channel. Add GitHub Sponsors as a small extra.

### 2. Desktop app: $19 one-time, honor-system trial

**Decision:** the desktop app costs **$19 one-time**. It works fully during a
trial, then shows a friendly reminder, like WinRAR. `npx whyfull` and the CLI
never show the reminder.

Because nothing is enforced, all the code stays Apache 2.0. There's no private
module, no license change, and no DRM. Anyone could reset the trial by deleting
a local file, and that's fine. The reminder only needs to nudge people who
already find the app useful.

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

The README can still say "Free and open source". Add "The desktop app is
$19 if you keep using it" next to the download link.

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
3. Set up checkout with a merchant of record that handles taxes (Lemon
   Squeezy, Paddle, or similar). Measure conversion from checkout only, never
   from the app.
4. Build history and trends, then watch mode, as license extras.

## Sources

- [Wombit on BetterLaunch](https://www.betterlaunch.co/product/wombit)
- [CleanMyMac purchase options (MacPaw)](https://macpaw.com/support/cleanmymac/knowledgebase/purchase-options)
- [MacRumors: redesigned CleanMyMac pricing](https://www.macrumors.com/2024/10/16/macpaw-releases-redesigned-cleanmymac/)
- [DaisyDisk pricing](https://daisydiskapp.com/support/pricing)
- [Mole on GitHub](https://github.com/tw93/Mole)
- [How Cap makes money from open source](https://flaviocopes.com/cap-business-model/)
