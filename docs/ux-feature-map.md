# UX re-audit feature map

Existing screen roots and element IDs are retained; no prices or payment/owner rules are changed.

| Existing feature / entry | New location / behavior |
|---|---|
| Card-of-day teaser + duplicate full reading | Day has one teaser and primary Open card CTA; full reading is a nested `daily` route with Back |
| Ask / Love | Two secondary Day scenarios; nested Cards question form |
| Mana promotional block | Compact balance in Day header; opens Mana tab |
| Profile banner / natal / compatibility | Profile tab feature section; avatar is a native button |
| My day / journal / check-in / journal history | Day disclosure, preserving existing IDs and journal behavior |
| Moon card / lunar details | Profile feature section and nested lunar route |
| All tools / forecast / biorhythm | Profile tools disclosure; nested routes |
| Dreambook | Cards secondary entry; nested dream route |
| Decks / spreads | Cards; catalog implementation owned separately |
| Stars packs / reward / referrals | Mana; existing controls retained |
| Saved readings / search / filters / reopen | History; server-backed authenticated results only |
| Guest / expired auth / API error | Separate History notices; Telegram entry or explicit retry, never false empty state |

## Navigation contract

`activateScreen` normalizes child routes to parent tabs, keeps exactly one visible root and `aria-current=page` tab, and records prior route/scroll. Close and Telegram Back restore the prior route, falling back to Day. Profile drafts are not rebuilt by background hydration. Returning to Cards remounts its working area. Direct chart entry returns to Day.

Arc displays persistent loading and retry UI. Request generations prevent delayed bundle completion from taking over a newer route. Successful History entry refreshes server data, concurrent refresh is deduplicated, and errors remain distinguishable from authenticated empty history.

## Local verification

`PW_PORT=4195 npx playwright test e2e/ux-navigation.spec.js --workers=1`

Tests use explicit mocked Telegram SDK and API fixtures across 320/360/390 px. These are UI regressions, not evidence of real Telegram authorization, owner bypass, payment processing or server persistence. No deployment or commit is performed by this task.
