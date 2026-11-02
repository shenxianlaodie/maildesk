# Unread queue replenishment

User-approved behavior: retain existing owners, replenish cs01/cs02/cs03 and Li Hui to 100 unread customer conversations; owners over target receive nothing. Continue replenishing automatically. When supply is short, assign oldest unread conversations to the eligible member with the smallest unread queue. Respect mailbox permissions and do not split a customer conversation.

1. Add tested `backend/unread-assignment.cjs`: disabled-by-default persisted configuration, transactional assignment and audit, active staff and mailbox checks, skip in-flight or uncertain sends, oldest-first selection, minimum-load allocation, persisted run summary.
2. Add a 30-second timer with startup run and clean shutdown, integrate in non-demo pilot lifecycle. Tests cover scarcity, existing owners, permissions, refill, idempotency, rollback and lifecycle.
3. Run full tests and independent review. Deploy only the new module and pilot lifecycle hooks over current production files with hash checks and rollback.
4. Configure the four verified staff IDs and target 100, run first refill, verify per-member unread counts, unchanged existing owners, audit entries and automatic next run. No reply exclusivity or claiming UI is part of this change.
