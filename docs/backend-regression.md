# Gadalka backend regression audit — 2026-10-25

## Outcome and evidence boundary

**PASS: typecheck, 11 selected existing backend regression scripts, and two supplemental assertion groups (owner/auth/ordinary gates and referrals).** These results exercise real local backend TypeScript, HTTP handlers, migrations and SQLite repositories, with synthetic identities and loopback AI fixtures. They are **not frontend mocked-route evidence and not authenticated staging/production acceptance**. No real Telegram payments, invoices, AI provider requests or live user actions were performed.

Read the supplied `doc_faae0fd17c5c_GADALKA_UX_REAUDIT_2026-10-25.md`. Its explicit exclusions (backend not rechecked, owner bypass/auth/payment flows untested) remain valid for that original guest/live UX audit. This report adds isolated backend evidence only; it does not invalidate the UX findings or establish the running production SHA.

## Source, isolation, and setup

- Source: `/home/hermes/astro-natal-bot`, live workdir, inspected read-only.
- Exact HEAD: **`203dc0b6a0d70b0240ebe8c52c28725e0b3e77d0`**, branch `master`; `git --no-optional-locks ... status --short` returned empty and tracked diff was empty.
- Used `git -C /home/hermes/astro-natal-bot archive --format=tar HEAD`, validated tar members (regular files/directories only; rejected env/database/key/symlink paths), extracted 229 entries to fresh `/home/hermes/gadalka-backend-ux-tests`. No production `.env`, database, SSH key, node_modules or untracked file was copied. This is an archive, not a Git clone.
- **Archive hygiene caveat:** inspection subsequently found a credential-like literal in the tracked legacy `scripts/test_e2e.ts`. That file was not executed and was removed from the disposable copy. No value is reproduced here. A final token/private-key-pattern scan of the remaining archive (excluding node_modules) returned no matches. Thus initial path-based filtering alone was not sufficient; the final copy has that legacy fixture excluded. This does not establish whether the old literal was valid.
- No source changes, deployment, push, commit, service restart or live tests. Only this report is written in the frontend deliverable tree. Disposable dependency files and test databases exist separately.
- Bun **1.4.3**. `bun install --frozen-lockfile` initially failed in better-sqlite3's native install script: missing Python distribution metadata for `gyp`. Reinstalled isolated dependencies using `bun install --frozen-lockfile --ignore-scripts` (54 packages). Backend uses `bun:sqlite`, so the unused Node native addon is not required for these tests. TypeScript resolved to 5.9.3.
- Read package.json/config/database setup/tests before execution. Package has no general `test` script: regression scripts are standalone Bun programs, not a test-runner suite with assertion totals.

## Executed existing regressions

All commands ran with cwd `/home/hermes/gadalka-backend-ux-tests`, never the live workdir.

```sh
BOT_TOKEN=test-token AI_API_KEY=test-key DB_PATH=/tmp/gadalka-typecheck-unused.sqlite bun run typecheck
```

Result: `tsc --noEmit`, exit 0.

Selected scripts were invoked as `bun scripts/<name>` with fake `BOT_TOKEN=test-token`, `AI_API_KEY=test-key`, `ADMIN_TELEGRAM_ID=472144090`. Script-local configuration selects fresh temporary databases; HTTP scripts override provider URLs with loopback fixture servers. The seven non-HTTP scripts were also rerun with a minimal environment containing PATH, isolated HOME and the fake values, plus `ARC_CARD_INTERPRET_DB=:memory:` and `API_ERROR_LOG_DB=:memory:`; all passed again.

| Exact script argument | Exit | Observed result / scope |
|---|---:|---|
| `scripts/test_release_hardening.ts` | 0 | Owner bypass, atomic mana guard, Stars amount validation and idempotency |
| `scripts/test_paid_request_lifecycle.ts` | 0 | Paid request lifecycle |
| `scripts/test_stars_payload.ts` | 0 | **7** Stars payloads round-trip |
| `scripts/test_history_idempotency.ts` | 0 | History request idempotency and migration |
| `scripts/test_db_restart.ts` | 0 | SQLite close/reopen preserves ledger, history, migrations |
| `scripts/test_analytics.ts` | 0 | Analytics persistence, dedupe and source attribution |
| `scripts/test_html_escape.ts` | 0 | HTML escape smoke |
| `scripts/test_http_refund.ts` | 0 | Forced loopback provider failure → refund → same-key retry → completed replay; one net debit and one successful provider operation |
| `scripts/test_paid_request_idempotency.ts` | 0 | Concurrent paid duplicate, completed replay, payload conflict and cross-user scope |
| `scripts/test_concurrent_http.ts` | 0 | **20** concurrent HTTP history requests converge to one idempotent record |
| `scripts/test_http_cache.ts` | 0 | Persistent card cache serves a new history key without another LLM call or extra Mana spend |

Exact HTTP batch:

```sh
for t in test_http_refund.ts test_paid_request_idempotency.ts test_concurrent_http.ts test_http_cache.ts; do
  BOT_TOKEN=test-token AI_API_KEY=test-key ADMIN_TELEGRAM_ID=472144090 bun "scripts/$t"
done
```

The initial HTTP imports logged optional `data/card_interpretations.db` / `data/api_error_log.db` open failures because those disposable-copy paths did not exist. This disabled optional auxiliary storage, not the temporary primary DB; all assertions passed. Cache regression explicitly configured its own persistent temporary cache. The supplemental test configured both auxiliary databases in memory to avoid these warnings.

**Count interpretation:** 11 unique existing script programs, all exit 0, plus one successful typecheck. Repeated executions are not additional unique tests. No fabricated aggregate assertion count is claimed.

## Supplemental real-handler checks

Executed via Python `subprocess.run(['bun', 'run', '-'], input=<inline TypeScript>, cwd=isolated_copy, env=<minimal fake environment>, timeout=90)`; exit 0. The inline program was not added to production or committed. Exact runtime environment:

```text
HOME=/home/hermes/gadalka-backend-ux-tests
BOT_TOKEN=test-token
AI_API_KEY=test-key
ADMIN_TELEGRAM_ID=472144090
DB_PATH=/tmp/gadalka-extra-owner-referral.sqlite
ARC_CARD_INTERPRET_DB=:memory:
API_ERROR_LOG_DB=:memory:
API_HOST=127.0.0.1
API_PORT=0
PATH=inherited executable path
```

The program sets `AI_BASE_URL` to an ephemeral `127.0.0.1` fixture server; a fetch guard rejects non-loopback hosts. No OS-level network namespace was used; existing scripts use their inspected local fixtures. Source imports are the unchanged backend implementation.

### Group 1: owner, signed identity, ordinary gates, persisted history

- Create owner Telegram ID 472144090 and ordinary synthetic ID 990001 in a migrated disposable SQLite DB.
- Grant and consume each starter 12 Mana, explicitly assert both balances are zero before requests. This matters: an uninitialized ledger would receive starter Mana and would not prove zero-balance bypass.
- Sign Telegram Mini App initData using HMAC and **fake** bot token; call real `/api/arc/interpret` over loopback HTTP.
- Tamper an ordinary user's signed initData to claim the owner ID: **401**.
- Ordinary zero-Mana request, even with body `isOwner: true` and owner `userId`: **402**, no provider invocation. Client body identity cannot confer owner access on this route.
- Valid signed owner at zero Mana: **200**, returned history ID, unchanged zero balance, **unchanged ledger row count**, **zero ai_usage rows**.
- Repeat owner request ID: `x-idempotent-replay: true`; **one** total fixture-provider invocation.
- Close/reopen SQLite and assert exactly **one** owner history row still exists.
- Seed ordinary user's five tarot usage records; next fresh request: **429**, provider count remains one.

Observed output: `PASS: signed owner zero balance, unchanged ledger/usage, persisted/replayed history; forged identity 401; ordinary 402 and 429`.

Code corroboration: `api-server.ts` resolves internal user back to stored Telegram ID for owner checks (130–155); tarot claims charge cost zero only for that owner (1057–1064), and atomically record usage/history through the existing completion path (1090–1113). Owner usage recording is skipped, history is not skipped.

**Limits:** this newly added inline scenario covers tarot interpretation, not every AI route or all bot chat handlers. Signed initData is locally generated with a dummy token, not captured from Telegram. SQLite close/reopen is not a service-manager restart. A frontend's rendering of owner status, displayed prices or history remains a separate integration question.

### Group 2: referrals

Using actual referral repository functions and disposable DB:

- Self-referral rejected.
- First activation grants **10 bonus Mana**; repeat reports `already_registered`.
- First referred purchase reward grants **20 paid Mana**; repeat reports `purchase_reward_already_given`, paid balance remains 20.
- Additional synthetic referrals result in exactly **five** `reward_given=1` rows for the referrer, matching the configured seven-day cap.

Observed output: `PASS: referral activation +10, self/repeat rejection, purchase +20 exactly once, weekly rewarded-row cap 5`.

**Important nuance:** bonus cap is 15. Rewarded-row count is not proof each referral actually receives 10 spendable Mana: repository code marks `reward_given=1` even when the effective grant is capped. Product wording should distinguish advertised maximum from effective credit. This was not classified as a new defect without a product requirement. Real deep-link attribution, live Telegram purchases and multi-process crash interleavings were not exercised by this supplemental group.

## Remaining acceptance limits

- Local Stars tests validate parsers, amount/currency guards and receipt/idempotency logic, not Telegram's real invoice/payment callback delivery or a real refund transaction.
- HTTP refund regression tests failed-AI Mana compensation, **not a Telegram Stars refund**.
- No real external AI quality/latency, payment fulfillment, staging authorization or production persisted-user validation.
- Unsafe/irrelevant legacy integration scripts (including credential-bearing `test_e2e.ts`, external `test_llm.ts`, Telegram smoke runners) were deliberately not run; this is not a claim that every repository test passed.
- The owner is configured synthetically to the ID under test; no live environment was read to establish production ADMIN_TELEGRAM_ID.
- A separate controlled staging/Telegram acceptance pass is still required before asserting end-to-end live readiness. These backend passes do not resolve frontend UX/UI acceptance findings.
