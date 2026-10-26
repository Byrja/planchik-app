# UX-04 — Arc catalog regression

## Implementation retained and reviewed

- Shared catalog for card and coin templates: `one`, `three`, `yesno` visible initially; ten other spread IDs under native «Другие расклады» disclosure.
- All 13 existing spread IDs, five decks and combined-deck mode retained. Public `ArcApp.setSpread()` remains the compatibility/deep-link entry point; no new URL parser claimed.
- Selected spread name stays visible when disclosure closes; pressed state and disclosure survive template changes. History-tab round trip preserves spread.
- Old parallel desktop/mobile pickers removed on mount and hidden during lazy loading.
- AI answer and individual-card interpretation show 7 mana before invocation. No billing or owner rules changed.

## Regression corrections

The previous failures were test-contract problems, not a hidden third deck or absent price text:

1. The full spread/deck matrix exceeded the default 30-second test budget while Playwright was scrolling to a later deck button. It passes with a 120-second budget for that matrix only; normal actionability checks and real clicks are retained.
2. Drawing is a two-step ritual. The price test now clicks the visible focus-dialog draw button before asserting the result and AI price. It also asserts visibility and verifies no paid interpretation request was made.

No skips, forced clicks, configuration edits, deployment or commit.

## Validation scope

Command: `PW_PORT=4194 npx playwright test e2e/ux-catalog.spec.js --workers=1`

Three mobile projects: 320×700, 390×844, 360×800. API fixtures are local mocks; deck data and UI are real. Tests cover catalog disclosure, all spreads/decks, rare public-entry routing, coin remount, history-tab return, prices, and failed lazy-load recovery.

`npm run check` passed; `npm test` retry passed 9/9. Initial unit attempt aborted with exit 134 under shared-host thread pressure. Concurrent browser runs also caused Python HTTP-server `RuntimeError: can't start new thread`. The first Playwright run passed the full matrix on 320px (1.1 minutes) and the rare-entry/history test before external termination (143). Its orphaned server was stopped before rerunning. Logs: `/tmp/gadalka-arc-finish.log`, `/tmp/gadalka-arc-retry.log`; final status must distinguish environment failures from assertion failures.

Existing missing coin WebP assets return 404 locally; these assets are outside this scoped change. No real Telegram authorization, AI billing, server history persistence, owner bypass or staging verification is claimed.
