# UI principles

These are product requirements for every Whyfull interface: the viewer, desktop
shell, public site, dialogs, forms, empty states, and feedback.

## Say only what the user needs

- Let titles, labels, controls, and layout explain familiar UI. Settings needs no
  introduction; a search field needs no paragraph explaining search.
- Remove repeated titles, subtitles, instructions, reassurance, and marketing
  from task flows. Prefer a short label to a sentence.
- Keep copy that changes a decision: cost, privacy consequences, destructive
  effects, measurement limits, unavailable features, and recovery steps.
- Put supporting metadata, implementation details, and advanced tools behind
  disclosure. Do not replace deleted paragraphs with a wall of tooltips.
- Empty states should name the state and offer an action when one is available.
  Errors should name the problem and the next useful action.
- Keep accessible labels, status announcements, keyboard support, and focus
  behavior even when visible text is removed.

## Give each control one job

- Navigation selects a destination. Settings changes preferences. Actions do
  work. Keep these responsibilities visually and structurally distinct.
- Give each preference one home. Put contextual actions beside the relevant
  item. Move rare technical actions into Advanced or an overflow menu.
- Use consistent names for the same destination and action across interfaces.
- Show the primary action clearly; avoid competing explanatory boxes and
  repeated controls. Keep necessary confirmation at the action it affects.

## Make destinations addressable

- Store persistent sections and panels in the URL, using the app's existing
  routing conventions. Avoid a second local state for the same destination.
- Direct links, reloads, and browser Back/Forward must restore the same view.
  Preserve the underlying folder, document, and relevant search context.
- Validate route values. Preserve existing links when navigation is reorganized.
- Keep transient confirmations, unsaved form values, and execution state local.
  Do not put secrets or destructive actions in URLs.

Viewer links use `?settings=general|places|instructions|rules|advanced|license`,
`?page=report` for suggestions, and `?panel=scan|shortlist|files` for
persistent panels. Imported reports use `?reportSection=targets|caches|discovered|worktrees`.

## Review the result

Check the interface at desktop and narrow widths, keyboard navigation, and any
changed direct links. Keep screenshots and automated checks proportional to the
change. Preserve meaningful warnings and existing behavior while reducing noise.
