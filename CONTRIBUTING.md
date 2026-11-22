# Contributing to Whyfull

Thank you for helping make Whyfull better. Bug reports, new cache locations,
documentation fixes and code contributions are all welcome.

Whyfull is **source available**, not open source: its source is public so you
can see exactly what it does, and it is licensed under the Whyfull
Source-Available License (`LICENSE`). To keep the project's licensing clear,
every contribution is accepted under the Contributor License Agreement below.

## Reporting bugs and suggesting locations

Open an issue at https://github.com/iplanwebsites/whyfull/issues. Include
your platform, how you ran Whyfull (npm, standalone CLI or desktop app) and,
if you are comfortable sharing it, the relevant part of `whyfull --json`.
Reports can contain private paths: remove anything you'd rather not share.

For security problems, please do not open a public issue; write to
support@whyfull.app instead.

## UI changes

Follow [the UI principles](docs/ui-principles.md): concise copy, clear separation
of navigation and actions, and URL state for persistent destinations.

## Pull requests

1. Keep each pull request focused on one change.
2. Follow the existing style and run `pnpm check` (formatting, types and
   tests) before submitting.
3. For a new location in the catalog, explain where the data comes from and
   how the owning tool recommends cleaning it up.
4. **Include the CLA statement** (see "How to sign") in the pull request
   description. We cannot merge a pull request without it.

## Contributor License Agreement

> **Draft: needs lawyer review before launch.**

This Contributor License Agreement ("CLA") applies to every Contribution You
submit to Felix Menard ("the Owner") for Whyfull.

**1. Definitions.** "You" means the individual (or, where You contribute on
behalf of an employer or other entity, that entity) submitting a
Contribution. "Contribution" means any code, data (including catalog
entries), documentation, design or other material that You submit to the
Owner, for example through a pull request, patch, issue or discussion,
intended for inclusion in Whyfull. "Whyfull" means the software, catalog,
documentation and related materials owned by the Owner.

**2. Assignment of copyright.** To the extent permitted by law, You assign to
the Owner all right, title and interest, including copyright, in Your
Contributions.

**3. License where assignment is not possible.** To the extent any right
cannot be assigned, or the assignment is held ineffective, You grant the
Owner and anyone who receives Whyfull from the Owner a perpetual, worldwide,
irrevocable, non-exclusive, royalty-free, fully paid-up, transferable and
sublicensable (through multiple tiers) license to use, reproduce, modify,
prepare derivative works of, publicly display and perform, distribute,
sublicense and otherwise exploit Your Contributions in any form and under any
license terms, including proprietary, commercial, source-available or open
source terms. **This includes the right to relicense Your Contributions, and
Whyfull as a whole, under any terms the Owner chooses, now or in the
future.**

**4. Patent license.** You grant the Owner and anyone who receives Whyfull
from the Owner a perpetual, worldwide, irrevocable, non-exclusive,
royalty-free patent license to make, have made, use, sell, offer to sell,
import and otherwise transfer Your Contributions and Whyfull as combined with
them, under any patent claims You can license that are necessarily infringed
by Your Contributions.

**5. Moral rights.** To the extent permitted by law, You waive, and agree not
to assert, any moral rights in Your Contributions against the Owner or its
licensees.

**6. Your representations.** You represent that:

- each Contribution is Your original work, or You have the right to submit
  it under this CLA, and You will identify any third-party material in it and
  its license;
- if Your employer or anyone else has rights in Your Contributions, You have
  their permission to submit them under this CLA, or they have waived those
  rights;
- to Your knowledge, Your Contributions do not infringe anyone's rights; and
- You are legally able to enter into this CLA.

You will tell the Owner promptly if any of these become untrue.

**7. No obligation; no warranty from You.** The Owner is not obliged to use
or merge any Contribution. Except for Section 6, You provide Your
Contributions "as is", without warranties of any kind.

**8. No compensation; credit.** You receive no payment or other compensation
for Contributions. The Owner may credit contributors, for example in release
notes or the git history, but is not obliged to.

**9. Retained rights.** Nothing in this CLA stops You from using material You
wrote independently of Whyfull, as long as You do not use Whyfull's
materials beyond what the Source-Available License allows.

**10. General.** This CLA is governed by the laws of the Province of Quebec
and the federal laws of Canada applicable there, and the courts of the
judicial district of Montreal, Quebec, have jurisdiction. If any provision is
unenforceable, the rest remains in effect. This CLA applies to all
Contributions You submit after accepting it, until You notify
support@whyfull.app in writing that it no longer applies to future
Contributions.

### How to sign

Add this statement, unchanged, to the description of your pull request (or
to the issue or email containing your contribution):

```text
I have read the Whyfull Contributor License Agreement in CONTRIBUTING.md and
I agree to its terms for this and all my future contributions to Whyfull.
Name: <your full legal name>
GitHub: <your GitHub username>
Contributing on behalf of: <"myself" or your employer's name>
```

If you contribute on behalf of an employer, make sure you are authorized to
do so; we may ask for a confirmation from the employer.
