# Assignment and Statistics Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task.

**Goal:** Implement approved 20-conversation refill/rebalancing and detailed shop mail statistics.
**Architecture:** Extend the existing SQLite worker and HTTP application; keep queries metadata-only. Add assignment generation checks and small browser modules instead of refreshing whole conversations periodically.
**Tech Stack:** Node 24, node:sqlite, plain browser JS, node:test.
**Spec:** ../specs/2026-11-16-unread-rebalancing-design.md and ../specs/2026-11-16-reply-statistics-design.md (approved by user: 执行).

## Global Constraints
- Four existing configured accounts; unassigned oldest-first, transfers newest-first, donor retains20. No transfer of read, sending, unknown, forbidden or outside-roster conversations.
- Statistics use UTC+8 mail timestamps, accepted outgoing records, permissions and no duplicate shop attribution. No external order lookups.
- Preserve drafts and prevent stale sends after transfers. Do not deploy, push or merge as part of local implementation.
- Use existing isolated clone remaining-submit; base2a512af, no real tracked diff before work. Preserve root repository unrelated changes.

## Review Focus
- Sending starts between poll and transfer: atomic registration with generation check.
- Transfer away and back before poll: monotonic assignment generation, not only owner comparison.
- Poll after switching customers: discard outdated result; preserve text and selected files.
- Shared inbox attribution and normal staff totals must not disclose other accounts.
- Insufficient eligible supply must settle without oscillation; multiple messages count once.

## Task 1: Refill and assignment protection
- [x] Add failing tests to tests/unread-assignment.test.cjs: oldest unowned first; newest transfers; retain donor target; permissions, in-flight exclusion, audit rollback and repeated runs.
- [x] Add backend assignment generation state and helpers in backend/assignment-state.cjs; expose a cheap permission-checked current-customer state endpoint through desk.cjs and proxy.cjs.
- [x] Update backend/unread-assignment.cjs for opt-in transferExcess and target20 configuration preparation, retaining existing behavior for configurations not opted in. Write old/new ownership and audit atomically.
- [x] Add sendReply generation validation in smtp.cjs within transaction that records sending. Add behavior tests for stale snapshots and race protection.
- [x] Add browser assignment-watch.js with tests for delayed poll, repeated alerts, read-only refresh and draft preservation. Integrate desk/app.js and index.html plus proxy asset whitelist.
- [x] Provide dry-run/apply configuration script scoped to existing four configured accounts; never mutate production from tests.
- [x] Run targeted node --test suites and record results.

## Task 2: Statistics (independent implementer)
- [x] Add failing range, bucket, attribution, incoming and permission tests.
- [x] Extend reply-stats.cjs/desk route/proxy integration with range+granularity; preserve legacy date/period/hour queries and existing accepted count semantics.
- [x] Add a dedicated browser reply-statistics.js for filters, summaries, shop/time/staff detail and paging; replace only openReplyStats block in app.js. Integrate asset and styles; coordinate shared files.
- [x] Run targeted tests and self-review counts, dates, permissions, performance.

## Task 3: Integration and independent review
- [x] Run full npm test equivalent using Node24; validate syntax and git diff --check.
- [x] Independent reviewer checks entire diff against both specs; fix and rerun affected tests.
- [x] Record completion and clearly report local-only status and remaining deployment step.

## Execution Ledger
- User approved both specs with 执行. No further confirmation is required for implementation.
- Ruling: maintain donor minimum20 even when total<80; prioritize smallest recipient queue rather than forcibly average existing sub20 queues, matching explicit user choice.

## Completion evidence (2026-11-16)
- Full suite: Node 24 `--test --test-concurrency=1 tests/*.test.cjs`: 462 passed, 0 failed (24.3 seconds). `git diff --check` passed.
- Independent review completed. P2 refresh finding fixed: assignment refresh reloads messages, outgoing, work status/revision and ownership while retaining local draft/files and loaded orders. Scoped re-review resolved the finding.
- Local demo browser verified date controls, hour grain, shop drilldown and received-mail counts.
- Local implementation only; no commit, push, merge, deployment or production configuration mutation performed.
- Deployment follow-up: deploy code and assets first, then run `node scripts/configure-unread-assignment.cjs EXISTING_DATABASE --dry-run`; inspect the four existing accounts, then use `--apply` to set target 20 and enable surplus transfers. Do not replace the existing account IDs.

## Release and merge verification
- User subsequently authorized deployment and GitHub push/merge. Both releases are live; latest image `maildesk:stats-hours-1794817761` is healthy. Existing four-account setting is now target 20 with surplus transfers enabled.
- Statistics supports inclusive date ranges and the same startHour/endHour window each day (UTC+8, end hour exclusive); reply totals and staff detail appear first.
- Final full local suite: 463 passed, 0 failed. Production image also passed 463 tests. Live 09:00-12:00 totals matched database counts (111 inbound, 229 accepted replies at verification).
